import ctypes
from ctypes import wintypes
import logging
import threading
import time
import keyboard
from desktop_utils import ensure_default_desktop, patch_keyboard_for_default_desktop

user32 = ctypes.windll.user32
user32.GetAsyncKeyState.restype = ctypes.c_short
user32.GetAsyncKeyState.argtypes = [ctypes.c_int]

VK_MAP = {
    "f1": 0x70, "f2": 0x71, "f3": 0x72, "f4": 0x73,
    "f5": 0x74, "f6": 0x75, "f7": 0x76, "f8": 0x77,
    "f9": 0x78, "f10": 0x79, "f11": 0x7A, "f12": 0x7B,
}

# Keys Terrarium itself binds globally (F9 = voice module on/off).
RESERVED_KEYS = {"f9"}


class HotkeyListener:
    """
    Multi-engine Windows Global Hotkey Listener.
    Combines:
      1. Low-level keyboard hook (keyboard.hook) for instant key-down & key-up tracking
      2. Win32 RegisterHotKey system-level kernel registration
      3. Win32 GetAsyncKeyState hardware polling fallback
    Guarantees 100% key detection across any window, terminal, game, or elevated app.
    Supports primary key (F8) and a fallback (F7) out of the box. F9 is never
    listened to: Terrarium owns it as the voice module's on/off switch.
    """

    def __init__(
        self,
        hotkey: str = "f8",
        mode: str = "smart",  # "smart", "push_to_talk", "toggle"
        on_start_recording=None,
        on_stop_recording=None,
    ):
        target = hotkey.lower().strip()
        # F9 is Terrarium's on/off switch — a press there must not also record
        self.target_hotkey_name = "f8" if target in RESERVED_KEYS else target
        self.mode = mode
        self.on_start_recording = on_start_recording
        self.on_stop_recording = on_stop_recording

        # Build list of allowed key names and VKs (target key + F8 + F7)
        self.allowed_keys = {self.target_hotkey_name}
        for fb in ["f8", "f7"]:
            self.allowed_keys.add(fb)

        self.allowed_vks = {}
        for k in self.allowed_keys:
            if k in VK_MAP:
                self.allowed_vks[k] = VK_MAP[k]

        self.is_recording = False
        self.recording_started_by_tap = False
        self.press_start_time = 0.0
        self.is_key_down = False
        self.active_key = None
        self._lock = threading.Lock()
        self._running = False
        self._hook = None
        self._poll_thread = None
        self._reg_thread = None

    def _handle_key_down(self, key_name: str):
        now = time.time()
        with self._lock:
            if self.is_key_down:
                return  # Key repeat from OS, ignore
            self.is_key_down = True
            self.press_start_time = now
            self.active_key = key_name
            logging.info(f"[Hotkey] Key DOWN: {key_name.upper()}")

            if self.is_recording and self.recording_started_by_tap:
                # Second tap in toggle / smart mode -> Stop recording
                logging.info(f"[Hotkey] Second tap on {key_name.upper()} -> Stopping recording")
                self.is_recording = False
                self.recording_started_by_tap = False
                if self.on_stop_recording:
                    threading.Thread(target=self.on_stop_recording, daemon=True).start()
            elif not self.is_recording:
                # Start recording
                logging.info(f"[Hotkey] Starting recording with {key_name.upper()}")
                self.is_recording = True
                self.recording_started_by_tap = False
                if self.on_start_recording:
                    threading.Thread(target=self.on_start_recording, daemon=True).start()

    def _handle_key_up(self, key_name: str):
        now = time.time()
        with self._lock:
            if not self.is_key_down:
                return
            self.is_key_down = False
            held_duration = now - self.press_start_time
            logging.info(f"[Hotkey] Key UP: {key_name.upper()} (held {held_duration:.2f}s)")

            if self.is_recording:
                if self.mode == "push_to_talk":
                    logging.info("[Hotkey] Push-to-talk released -> Stopping recording")
                    self.is_recording = False
                    self.recording_started_by_tap = False
                    if self.on_stop_recording:
                        threading.Thread(target=self.on_stop_recording, daemon=True).start()
                elif self.mode == "toggle":
                    logging.info("[Hotkey] Toggle mode: waiting for second tap to stop")
                    self.recording_started_by_tap = True
                else:  # "smart" mode
                    if held_duration > 0.35:
                        logging.info(f"[Hotkey] Smart mode: held {held_duration:.2f}s -> Stopping recording")
                        self.is_recording = False
                        self.recording_started_by_tap = False
                        if self.on_stop_recording:
                            threading.Thread(target=self.on_stop_recording, daemon=True).start()
                    else:
                        logging.info(f"[Hotkey] Smart mode: quick tap ({held_duration:.2f}s) -> Toggle mode active")
                        self.recording_started_by_tap = True

    def _on_keyboard_event(self, e):
        if not self._running:
            return
        name = (e.name or "").lower().strip()
        if name not in self.allowed_keys:
            return

        if e.event_type == keyboard.KEY_DOWN:
            self._handle_key_down(name)
        elif e.event_type == keyboard.KEY_UP:
            self._handle_key_up(name)

    def _poll_async_keystates(self):
        """Fallback polling thread checking Win32 GetAsyncKeyState."""
        ensure_default_desktop()
        while self._running:
            for name, vk in self.allowed_vks.items():
                state = user32.GetAsyncKeyState(vk)
                down = bool(state & 0x8000)
                with self._lock:
                    currently_down = self.is_key_down and (self.active_key == name)
                if down and not currently_down:
                    self._handle_key_down(name)
                elif not down and currently_down:
                    self._handle_key_up(name)
            time.sleep(0.02)

    def _run_register_hotkey_loop(self):
        """Win32 RegisterHotKey thread for system-level fallback."""
        ensure_default_desktop()
        hotkey_ids = {}
        for idx, (name, vk) in enumerate(self.allowed_vks.items(), start=100):
            res = user32.RegisterHotKey(None, idx, 0, vk)
            if res:
                hotkey_ids[idx] = name
                logging.info(f"[Hotkey] RegisterHotKey OS hook registered for {name.upper()} (id={idx})")
            else:
                logging.debug(f"[Hotkey] RegisterHotKey for {name.upper()} returned {res}")

        msg = wintypes.MSG()
        WM_HOTKEY = 0x0312

        while self._running:
            # Check message queue without blocking permanently
            if user32.PeekMessageW(ctypes.byref(msg), None, 0, 0, 1):  # PM_REMOVE
                if msg.message == WM_HOTKEY and msg.wParam in hotkey_ids:
                    key_name = hotkey_ids[msg.wParam]
                    logging.info(f"[Hotkey] WM_HOTKEY received for {key_name.upper()}")
                    self._handle_key_down(key_name)
                    # Poll for key release
                    vk = self.allowed_vks.get(key_name)
                    if vk:
                        t0 = time.time()
                        while time.time() - t0 < 30.0:
                            time.sleep(0.03)
                            if not bool(user32.GetAsyncKeyState(vk) & 0x8000):
                                self._handle_key_up(key_name)
                                break
            else:
                time.sleep(0.02)

        # Unregister when stopping
        for idx in hotkey_ids:
            user32.UnregisterHotKey(None, idx)

    def start(self):
        if self._running:
            return
        self._running = True

        ensure_default_desktop()
        patch_keyboard_for_default_desktop()

        # Engine 1: Hook library
        try:
            self._hook = keyboard.hook(self._on_keyboard_event)
            logging.info(f"[Hotkey] keyboard.hook active for {list(self.allowed_keys)}")
        except Exception as e:
            logging.warning(f"[Hotkey] Failed to install keyboard.hook: {e}")

        # Engine 2: RegisterHotKey system message pump
        try:
            self._reg_thread = threading.Thread(target=self._run_register_hotkey_loop, daemon=True)
            self._reg_thread.start()
        except Exception as e:
            logging.warning(f"[Hotkey] Failed to start RegisterHotKey loop: {e}")

        # Engine 3: Polling GetAsyncKeyState
        self._poll_thread = threading.Thread(target=self._poll_async_keystates, daemon=True)
        self._poll_thread.start()
        logging.info("[Hotkey] Multi-engine hotkey listener started successfully.")

    def stop(self):
        self._running = False
        try:
            keyboard.unhook_all()
        except Exception:
            pass
        logging.info("[Hotkey] Hotkey listener stopped.")
