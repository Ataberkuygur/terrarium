import json
import os
from pathlib import Path

DEFAULT_CONFIG = {
    "hotkey": "f8",
    "mode": "smart",  # "smart" (hold for PTT, tap to toggle), "push_to_talk", "toggle"
    "backend": "local",  # "local", "groq", "openai"
    "local_model": "large-v3-turbo",  # "large-v3-turbo", "medium", "small", "base"
    "device": "cuda",  # "cuda" (for RTX 5070) or "cpu"
    "compute_type": "float16",  # "float16", "int8_float16", "int8"
    "language": "tr",  # "tr" for Turkish, or None for auto-detect
    "initial_prompt": "Türkçe yazılım geliştirme, terminal ve konsol komutları, kodlar ve prompt ifadeleri.",
    "sound_effects": True,  # subtle audio beeps on start/stop
    "show_overlay": True,  # floating visual pill HUD
    "overlay_position": "top",  # "top", "bottom"
    "paste_delay_ms": 30,  # small delay before sending Ctrl+V
    "groq_api_key": "",  # Optional: for 200ms ultra-fast cloud transcription
    "openai_api_key": "",  # Optional: for OpenAI Whisper API
}

CONFIG_FILE = Path(__file__).parent / "config.json"


def load_config() -> dict:
    config = dict(DEFAULT_CONFIG)
    if CONFIG_FILE.exists():
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                user_cfg = json.load(f)
                config.update(user_cfg)
        except Exception as e:
            print(f"[Config] Error reading config.json: {e}, using defaults")
    else:
        save_config(config)
    
    # Check environment variables as fallbacks
    if not config.get("groq_api_key") and os.environ.get("GROQ_API_KEY"):
        config["groq_api_key"] = os.environ["GROQ_API_KEY"]
    if not config.get("openai_api_key") and os.environ.get("OPENAI_API_KEY"):
        config["openai_api_key"] = os.environ["OPENAI_API_KEY"]
        
    return config


def save_config(config: dict):
    try:
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(config, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"[Config] Error saving config.json: {e}")
