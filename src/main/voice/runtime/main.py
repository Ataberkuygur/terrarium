import os
import sys
import time
import threading
import ctypes
import logging
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from desktop_utils import ensure_default_desktop
ensure_default_desktop()

LOG_FILE = BASE_DIR / "superwhisper.log"
_log_handlers = [logging.FileHandler(str(LOG_FILE), encoding="utf-8")]
if sys.stdout is not None:
    # pythonw.exe has sys.stdout=sys.stderr=None — a StreamHandler on None
    # raises inside emit() on every record (silent under pythonw, but noisy
    # work per log call and it hides real logging errors)
    _log_handlers.append(logging.StreamHandler(sys.stdout))
logging.basicConfig(
    handlers=_log_handlers,
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)

from config import load_config, save_config
from audio_recorder import AudioRecorder
from transcriber import TranscriberManager
from injector import paste_text
from overlay import OverlayHUD
from hotkey_listener import HotkeyListener
import sounds
from tray import TrayManager


def acquire_single_instance_mutex():
    """Ensure only one instance runs at a time on Windows."""
    mutex_name = "Global\\SuperWhisper_Win_SingleInstance_Mutex_Terrarium"
    kernel32 = ctypes.windll.kernel32
    mutex = kernel32.CreateMutexW(None, False, mutex_name)
    last_error = kernel32.GetLastError()
    ERROR_ALREADY_EXISTS = 183
    if last_error == ERROR_ALREADY_EXISTS:
        logging.warning("[SuperWhisper] Another instance is already running! Exiting.")
        sys.exit(0)
    return mutex


class SuperWhisperApp:
    def __init__(self):
        self._mutex = acquire_single_instance_mutex()
        self.config = load_config()
        self.is_processing = False
        self._proc_lock = threading.Lock()

        logging.info("=" * 60)
        logging.info(f"Starting SuperWhisper - Hotkey: [{self.config.get('hotkey', 'f9').upper()}]")
        logging.info(f"Mode: {self.config.get('mode', 'smart')}")
        logging.info(f"Model: {self.config.get('local_model', 'large-v3-turbo')} on {self.config.get('device', 'cuda')}")
        logging.info("=" * 60)

        # 1. Initialize Overlay HUD
        self.overlay = None
        if self.config.get("show_overlay", True):
            try:
                self.overlay = OverlayHUD(position=self.config.get("overlay_position", "top"))
                logging.info("[App] Overlay HUD initialized successfully at top center.")
            except Exception as e:
                logging.error(f"[App] Failed to initialize overlay: {e}", exc_info=True)

        # 2. Initialize Audio Recorder
        self.recorder = AudioRecorder(sample_rate=16000)

        # 3. Initialize Transcriber
        self.transcriber = TranscriberManager(self.config)

        # 4. Initialize Hotkey Listener
        self.hotkey_listener = HotkeyListener(
            hotkey=self.config.get("hotkey", "f9"),
            mode=self.config.get("mode", "smart"),
            on_start_recording=self.on_start_recording,
            on_stop_recording=self.on_stop_recording,
        )

        # 5. Initialize Tray Manager
        self.tray = TrayManager(
            config=self.config,
            on_toggle_sound=self.on_toggle_sound,
            on_toggle_overlay=self.on_toggle_overlay,
            on_quit=self.shutdown,
        )

    def on_toggle_sound(self, enabled: bool):
        save_config(self.config)

    def on_toggle_overlay(self, enabled: bool):
        save_config(self.config)
        if not enabled and self.overlay:
            self.overlay.hide()

    def on_start_recording(self):
        with self._proc_lock:
            if self.is_processing:
                logging.info("[App] Ignored start: already processing previous audio")
                return

        active_key = getattr(self.hotkey_listener, "active_key", None) or self.config.get("hotkey", "f9")
        hotkey_name = active_key.upper()
        logging.info(f"[App] 🎙️ Recording started... (Press/release {hotkey_name} to transcribe)")

        # Sound feedback
        if self.config.get("sound_effects", True):
            sounds.play_start_sound()

        # Visual HUD: Listening state
        if self.config.get("show_overlay", True) and self.overlay:
            self.overlay.show_listening(hotkey=hotkey_name)

        # Update Tray icon
        self.tray.update_status("recording")

        # Start audio capture
        try:
            self.recorder.start()
        except Exception as e:
            logging.error(f"[App] Error starting audio: {e}", exc_info=True)
            if self.overlay:
                self.overlay.show_error(f"Mic Error: {e}")

    def on_stop_recording(self):
        with self._proc_lock:
            if self.is_processing:
                return
            self.is_processing = True

        logging.info("[App] ⏹️ Recording stopped. Processing audio pipeline...")

        # Sound feedback
        if self.config.get("sound_effects", True):
            sounds.play_stop_sound()

        # Visual HUD: Listened stage
        if self.config.get("show_overlay", True) and self.overlay:
            self.overlay.show_listened()

        # Update Tray icon
        self.tray.update_status("transcribing")

        def _process_pipeline():
            try:
                # Brief visual pause so the user sees 'Listened'
                time.sleep(0.18)

                if self.config.get("show_overlay", True) and self.overlay:
                    self.overlay.show_transcribing()

                # 1. Grab recorded audio
                audio_data = self.recorder.stop()
                if audio_data is None or len(audio_data) < 16000 * 0.2:
                    logging.warning("[App] Audio too short or empty.")
                    if self.overlay:
                        self.overlay.show_error("Hold/tap to speak")
                    self.tray.update_status("idle")
                    return

                duration = len(audio_data) / 16000.0
                logging.info(f"[App] Transcribing {duration:.2f}s of audio with faster-whisper...")

                # 2. Transcribe
                t0 = time.time()
                text = self.transcriber.transcribe(audio_data, sample_rate=16000)
                elapsed = time.time() - t0

                if text:
                    logging.info(f"[App] ({elapsed:.2f}s) Result: \"{text}\"")

                    # 3. Paste into focused application
                    paste_delay = self.config.get("paste_delay_ms", 30)
                    success = paste_text(text, delay_ms=paste_delay)

                    if success:
                        logging.info("[App] Successfully pasted into active application.")
                        if self.config.get("sound_effects", True):
                            sounds.play_success_sound()
                        if self.config.get("show_overlay", True) and self.overlay:
                            self.overlay.show_pasted()
                    else:
                        logging.warning("[App] Paste failed.")
                        if self.overlay:
                            self.overlay.show_error("Paste Failed")
                else:
                    logging.info("[App] No speech detected.")
                    if self.config.get("sound_effects", True):
                        sounds.play_error_sound()
                    if self.overlay:
                        self.overlay.show_error("No speech heard")

            except Exception as e:
                logging.error(f"[App] Pipeline error: {e}", exc_info=True)
                if self.config.get("sound_effects", True):
                    sounds.play_error_sound()
                if self.overlay:
                    self.overlay.show_error(f"Error: {e}")

            finally:
                self.tray.update_status("idle")
                with self._proc_lock:
                    self.is_processing = False

        threading.Thread(target=_process_pipeline, daemon=True).start()

    def _heartbeat_loop(self):
        """Writes a fresh timestamp every 3s — the Electron service treats a
        heartbeat older than ~15s as a dead engine and respawns it. This is
        the only reliable liveness signal: a hung process still matches the
        'main.py' process-list grep, and a foreign SuperWhisper install can
        hold the mutex without being ours."""
        hb = BASE_DIR / "heartbeat"
        while True:
            try:
                hb.write_text(str(time.time()), encoding="utf-8")
            except Exception:
                pass
            time.sleep(3)

    def run(self):
        # Start hotkey listener
        self.hotkey_listener.start()
        hk = self.config.get("hotkey", "f9").upper()
        logging.info(f"[App] Ready! Press or hold {hk} anywhere on Windows to talk.")

        # Liveness heartbeat for the supervising Electron service
        threading.Thread(target=self._heartbeat_loop, daemon=True).start()

        # Run tray loop in main thread
        try:
            self.tray.run()
        except (KeyboardInterrupt, SystemExit):
            self.shutdown()

    def shutdown(self):
        logging.info("[App] Shutting down...")
        self.hotkey_listener.stop()
        if self.overlay:
            self.overlay.hide()
        sys.exit(0)


if __name__ == "__main__":
    app = SuperWhisperApp()
    app.run()
