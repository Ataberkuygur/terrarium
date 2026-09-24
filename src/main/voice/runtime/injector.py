import time
import ctypes
from ctypes import wintypes
import pyperclip

# Win32 Constants
VK_CONTROL = 0x11
VK_V = 0x56
KEYEVENTF_KEYUP = 0x0002


def paste_text(text: str, delay_ms: int = 30) -> bool:
    """
    Copies text to clipboard and simulates Ctrl+V into whatever window is currently focused.
    """
    if not text or not text.strip():
        return False

    clean_text = text.strip()
    
    # Store old clipboard content optionally, but user usually wants the transcribed text on clipboard anyway
    try:
        pyperclip.copy(clean_text)
    except Exception as e:
        print(f"[Injector] Clipboard error: {e}")
        return False

    # Short delay to allow clipboard sync
    if delay_ms > 0:
        time.sleep(delay_ms / 1000.0)

    # Simulate Ctrl+V using keybd_event
    user32 = ctypes.windll.user32
    
    # Press Ctrl
    user32.keybd_event(VK_CONTROL, 0, 0, 0)
    time.sleep(0.01)
    
    # Press V
    user32.keybd_event(VK_V, 0, 0, 0)
    time.sleep(0.01)
    
    # Release V
    user32.keybd_event(VK_V, 0, KEYEVENTF_KEYUP, 0)
    time.sleep(0.01)
    
    # Release Ctrl
    user32.keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, 0)
    
    return True
