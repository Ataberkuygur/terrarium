import os
import subprocess
import threading
from PIL import Image, ImageDraw
import pystray
from pystray import MenuItem as item, Menu


def create_tray_icon_image(status: str = "idle") -> Image.Image:
    # 64x64 icon
    width = 64
    height = 64
    image = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    # Colors
    if status == "recording":
        bg_color = (239, 68, 68, 255)  # Red
        mic_color = (255, 255, 255, 255)
    elif status == "transcribing":
        bg_color = (245, 158, 11, 255)  # Amber
        mic_color = (255, 255, 255, 255)
    else:
        bg_color = (59, 130, 246, 255)  # Blue / Indigo
        mic_color = (255, 255, 255, 255)

    # Circle background
    draw.ellipse([4, 4, width - 4, height - 4], fill=bg_color)

    # Microphone capsule
    draw.rounded_rectangle([25, 16, 39, 36], radius=7, fill=mic_color)

    # Microphone stand / cradle arc
    draw.arc([20, 26, 44, 44], start=0, end=180, fill=mic_color, width=3)
    # Stand line
    draw.line([32, 44, 32, 50], fill=mic_color, width=3)
    # Base line
    draw.line([24, 50, 40, 50], fill=mic_color, width=3)

    return image


class TrayManager:
    def __init__(self, config: dict, on_toggle_sound=None, on_toggle_overlay=None, on_quit=None):
        self.config = config
        self.on_toggle_sound = on_toggle_sound
        self.on_toggle_overlay = on_toggle_overlay
        self.on_quit = on_quit
        self.icon = None

    def _open_config(self):
        from config import CONFIG_FILE
        try:
            os.startfile(str(CONFIG_FILE.parent))
        except Exception as e:
            print(f"[Tray] Error opening config folder: {e}")

    def _get_menu(self):
        hotkey = self.config.get("hotkey", "F8").upper()
        backend = self.config.get("backend", "local").capitalize()
        model = self.config.get("local_model", "large-v3-turbo")

        return Menu(
            item(f"SuperWhisper [{hotkey}] — Active", lambda: None, enabled=False),
            item(f"Backend: {backend} ({model})", lambda: None, enabled=False),
            Menu.SEPARATOR,
            item(
                "Sound Feedback",
                self._toggle_sound,
                checked=lambda item: self.config.get("sound_effects", True),
            ),
            item(
                "Visual HUD Overlay",
                self._toggle_overlay,
                checked=lambda item: self.config.get("show_overlay", True),
            ),
            Menu.SEPARATOR,
            item("Open Settings Folder", lambda icon, item: self._open_config()),
            item("Quit SuperWhisper", lambda icon, item: self._quit()),
        )

    def _toggle_sound(self, icon, item):
        self.config["sound_effects"] = not self.config.get("sound_effects", True)
        if self.on_toggle_sound:
            self.on_toggle_sound(self.config["sound_effects"])

    def _toggle_overlay(self, icon, item):
        self.config["show_overlay"] = not self.config.get("show_overlay", True)
        if self.on_toggle_overlay:
            self.on_toggle_overlay(self.config["show_overlay"])

    def _quit(self):
        if self.icon:
            self.icon.stop()
        if self.on_quit:
            self.on_quit()

    def update_status(self, status: str):
        if self.icon:
            try:
                self.icon.icon = create_tray_icon_image(status)
            except Exception:
                pass

    def run(self):
        image = create_tray_icon_image("idle")
        hotkey = self.config.get("hotkey", "F8").upper()
        self.icon = pystray.Icon(
            "SuperWhisper",
            image,
            f"SuperWhisper [{hotkey}]",
            menu=self._get_menu(),
        )
        self.icon.run()
