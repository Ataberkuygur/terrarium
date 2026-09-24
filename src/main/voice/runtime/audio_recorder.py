import threading
import numpy as np
import sounddevice as sd
import logging


class AudioRecorder:
    def __init__(self, sample_rate: int = 16000, device_name: str = None):
        self.sample_rate = sample_rate
        self.device_name = device_name
        self.is_recording = False
        self._lock = threading.Lock()
        self._frames = []
        self._stream = None
        self.device_index = self._resolve_device_index()

    def _resolve_device_index(self):
        try:
            devices = sd.query_devices()
            # If explicit device_name configured, match it
            if self.device_name:
                for idx, d in enumerate(devices):
                    if d.get("max_input_channels", 0) > 0 and self.device_name.lower() in d["name"].lower():
                        print(f"[AudioRecorder] Using specified input device [{idx}]: {d['name']}")
                        return idx

            # Try default input device
            default_in = sd.default.device[0]
            if default_in is not None and default_in >= 0:
                dev = devices[default_in]
                if dev.get("max_input_channels", 0) > 0:
                    print(f"[AudioRecorder] Using system default input device [{default_in}]: {dev['name']}")
                    return default_in

            # Search for Intel Smart Sound or Mikrofon
            for idx, d in enumerate(devices):
                if d.get("max_input_channels", 0) > 0:
                    name_lower = d["name"].lower()
                    if "mikrofon dizisi" in name_lower or "intel" in name_lower:
                        print(f"[AudioRecorder] Auto-selected input device [{idx}]: {d['name']}")
                        return idx

            for idx, d in enumerate(devices):
                if d.get("max_input_channels", 0) > 0 and ("mikrofon" in d["name"].lower() or "microphone" in d["name"].lower()):
                    print(f"[AudioRecorder] Selected input device [{idx}]: {d['name']}")
                    return idx

        except Exception as e:
            print(f"[AudioRecorder] Device resolution error: {e}")
        return None

    def _audio_callback(self, indata, frames, time_info, status):
        if self.is_recording:
            self._frames.append(indata.copy())

    def start(self):
        with self._lock:
            if self.is_recording:
                return
            self.is_recording = True
            self._frames = []

            try:
                logging.info(f"[AudioRecorder] Opening InputStream (sr={self.sample_rate}, dev={self.device_index})...")
                self._stream = sd.InputStream(
                    samplerate=self.sample_rate,
                    channels=1,
                    dtype="float32",
                    device=self.device_index,
                    callback=self._audio_callback,
                    blocksize=1024,
                )
                self._stream.start()
                logging.info("[AudioRecorder] InputStream started successfully.")
            except Exception as e:
                self.is_recording = False
                self._stream = None
                logging.error(f"[AudioRecorder] Failed to start audio stream: {e}", exc_info=True)
                raise RuntimeError(f"Failed to start audio stream: {e}")

    def stop(self) -> np.ndarray:
        logging.info("[AudioRecorder] Stopping audio capture...")
        with self._lock:
            if not self.is_recording:
                return np.array([], dtype=np.float32)
            self.is_recording = False
            stream = self._stream
            self._stream = None

        if stream:
            try:
                stream.abort()
            except Exception as e:
                logging.warning(f"[AudioRecorder] Stream abort warning: {e}")
            try:
                stream.close()
            except Exception as e:
                logging.warning(f"[AudioRecorder] Stream close warning: {e}")
            logging.info("[AudioRecorder] Stream closed.")

        if not self._frames:
            return np.array([], dtype=np.float32)

        try:
            audio_data = np.concatenate(self._frames, axis=0).flatten()
            return audio_data
        except Exception as e:
            print(f"[AudioRecorder] Error assembling audio: {e}")
            return np.array([], dtype=np.float32)
