import io
import os
import sys
import threading
import logging
from pathlib import Path
import numpy as np
import soundfile as sf


def _setup_cuda_dlls():
    """Ensure NVIDIA cuBLAS and cuDNN DLLs from pip packages are accessible to CTranslate2."""
    added = []
    for p in sys.path:
        if "site-packages" in p or "dist-packages" in p:
            nv_base = Path(p) / "nvidia"
            if nv_base.is_dir():
                for sub in ["cublas", "cudnn", "cuda_nvrtc", "cuda_runtime"]:
                    bin_dir = nv_base / sub / "bin"
                    if bin_dir.is_dir():
                        bin_str = str(bin_dir)
                        if hasattr(os, "add_dll_directory"):
                            try:
                                os.add_dll_directory(bin_str)
                                added.append(bin_str)
                            except Exception:
                                pass
                        if bin_str not in os.environ.get("PATH", ""):
                            os.environ["PATH"] = bin_str + os.pathsep + os.environ.get("PATH", "")
    if added:
        print(f"[Transcriber] Registered CUDA DLL directories: {len(added)} paths")


_setup_cuda_dlls()


class TranscriberManager:
    def __init__(self, config: dict):
        self.config = config
        self.backend = config.get("backend", "local")
        self.local_model_name = config.get("local_model", "large-v3-turbo")
        self.device = config.get("device", "cuda")
        self.compute_type = config.get("compute_type", "float16")
        self.language = config.get("language", "tr")
        self.initial_prompt = config.get(
            "initial_prompt",
            "Türkçe yazılım geliştirme, terminal ve konsol komutları, kodlar ve prompt ifadeleri."
        )
        
        self._local_model = None
        self._local_loading = False
        self._local_lock = threading.Lock()
        self._ready_event = threading.Event()
        
        # Preload local model in background immediately
        self._ensure_local_model_loaded(async_load=True)

    def _ensure_local_model_loaded(self, async_load: bool = False):
        if self._local_model is not None:
            return

        need_start = False
        with self._local_lock:
            if self._local_model is not None:
                return
            if not self._local_loading:
                self._local_loading = True
                self._ready_event.clear()
                need_start = True

        if need_start:
            def _load():
                try:
                    from faster_whisper import WhisperModel
                    import ctranslate2

                    target_device = self.device
                    target_compute = self.compute_type

                    if target_device == "cuda":
                        cuda_count = ctranslate2.get_cuda_device_count()
                        if cuda_count < 1:
                            logging.warning("[Transcriber] No CUDA devices found. Falling back to CPU.")
                            target_device = "cpu"
                            target_compute = "int8"

                    logging.info(f"[Transcriber] Loading faster-whisper '{self.local_model_name}' on {target_device.upper()} ({target_compute})...")
                    try:
                        model = WhisperModel(
                            self.local_model_name,
                            device=target_device,
                            compute_type=target_compute,
                            cpu_threads=4,
                        )
                    except Exception as cuda_err:
                        if target_device == "cuda":
                            logging.warning(f"[Transcriber] CUDA load failed ({cuda_err}), attempting CPU fallback...")
                            model = WhisperModel(
                                self.local_model_name,
                                device="cpu",
                                compute_type="int8",
                                cpu_threads=4,
                            )
                        else:
                            raise cuda_err

                    self._local_model = model
                    logging.info(f"[Transcriber] faster-whisper '{self.local_model_name}' is ready on {target_device.upper()}!")
                except Exception as e:
                    logging.error(f"[Transcriber] Failed to load local model: {e}", exc_info=True)
                finally:
                    self._local_loading = False
                    self._ready_event.set()

            t = threading.Thread(target=_load, daemon=True)
            t.start()

        if not async_load:
            logging.info("[Transcriber] Waiting for model to finish loading...")
            self._ready_event.wait(timeout=60)
            logging.info("[Transcriber] Model load wait finished.")

    def transcribe(self, audio_data: np.ndarray, sample_rate: int = 16000) -> str:
        if audio_data is None or len(audio_data) < sample_rate * 0.2:
            return ""

        # Normalize audio volume so quiet microphones are loud and clear for Whisper
        max_val = np.max(np.abs(audio_data))
        if max_val > 0.005:
            audio_norm = (audio_data / max_val * 0.95).astype(np.float32)
        else:
            audio_norm = audio_data.astype(np.float32)

        backend = self.config.get("backend", "local").lower()

        # Try Cloud Groq if configured
        if backend == "groq" and self.config.get("groq_api_key"):
            try:
                text = self._transcribe_groq(audio_norm, sample_rate)
                if text:
                    return text
            except Exception as e:
                print(f"[Transcriber] Groq API error: {e}, falling back to local...")

        # Try Cloud OpenAI if configured
        if backend == "openai" and self.config.get("openai_api_key"):
            try:
                text = self._transcribe_openai(audio_norm, sample_rate)
                if text:
                    return text
            except Exception as e:
                print(f"[Transcriber] OpenAI API error: {e}, falling back to local...")

        # Local faster-whisper with RTX 5070 CUDA acceleration
        return self._transcribe_local(audio_norm, sample_rate)

    def _audio_to_wav_bytes(self, audio_data: np.ndarray, sample_rate: int) -> io.BytesIO:
        buf = io.BytesIO()
        buf.name = "audio.wav"
        audio_int16 = (audio_data * 32767).astype(np.int16)
        sf.write(buf, audio_int16, sample_rate, format="WAV", subtype="PCM_16")
        buf.seek(0)
        return buf

    def _transcribe_groq(self, audio_data: np.ndarray, sample_rate: int) -> str:
        from groq import Groq
        client = Groq(api_key=self.config["groq_api_key"])
        wav_buf = self._audio_to_wav_bytes(audio_data, sample_rate)
        
        kwargs = {
            "file": ("audio.wav", wav_buf.read()),
            "model": "whisper-large-v3-turbo",
            "response_format": "text",
        }
        if self.language:
            kwargs["language"] = self.language

        result = client.audio.transcriptions.create(**kwargs)
        if isinstance(result, str):
            return result.strip()
        return getattr(result, "text", str(result)).strip()

    def _transcribe_openai(self, audio_data: np.ndarray, sample_rate: int) -> str:
        from openai import OpenAI
        client = OpenAI(api_key=self.config["openai_api_key"])
        wav_buf = self._audio_to_wav_bytes(audio_data, sample_rate)

        kwargs = {
            "file": ("audio.wav", wav_buf.read()),
            "model": "whisper-1",
        }
        if self.language:
            kwargs["language"] = self.language

        result = client.audio.transcriptions.create(**kwargs)
        return result.text.strip()

    def _transcribe_local(self, audio_data: np.ndarray, sample_rate: int) -> str:
        if self._local_model is None:
            self._ensure_local_model_loaded(async_load=False)

        if self._local_model is None:
            raise RuntimeError("Local faster-whisper model could not be loaded.")

        # Ignore if audio is virtually inaudible silence
        if np.max(np.abs(audio_data)) < 0.008:
            return ""

        kwargs = {
            "beam_size": 1,
            "vad_filter": False,
            "condition_on_previous_text": False,
        }
        if self.language:
            kwargs["language"] = self.language
        if self.initial_prompt:
            kwargs["initial_prompt"] = self.initial_prompt

        segments, info = self._local_model.transcribe(audio_data, **kwargs)
        texts = [seg.text.strip() for seg in segments if seg.text.strip()]
        full_text = " ".join(texts).strip()

        # Filter out common YouTube / Whisper subtitle dataset hallucinations
        lower = full_text.lower().strip(" .,!?:-")
        hallucinations = [
            "altyazı", "altyazı m.k.", "altyazı:", "altyazi", "izlediğiniz için teşekkürler",
            "abone olmayı unutmayın", "teşekkürler", "you", "thank you", "thanks for watching",
            "subtitles by", "translated by", "subtitle by"
        ]
        if lower in hallucinations or lower.startswith("altyazı"):
            return ""

        return full_text
