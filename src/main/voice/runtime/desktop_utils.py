import ctypes
import logging

def ensure_default_desktop():
    """
    Ensures the calling thread is attached to the interactive 'Default' desktop
    where the user's screen and physical keyboard/mouse reside.
    """
    try:
        user32 = ctypes.windll.user32
        DESKTOP_ALL_ACCESS = 0x01FF
        h_default = user32.OpenDesktopW("Default", 0, False, DESKTOP_ALL_ACCESS)
        if h_default:
            res = user32.SetThreadDesktop(h_default)
            if res:
                return True
            else:
                logging.debug(f"SetThreadDesktop returned 0, err={ctypes.windll.kernel32.GetLastError()}")
    except Exception as e:
        logging.debug(f"ensure_default_desktop error: {e}")
    return False


def patch_keyboard_for_default_desktop():
    """
    Patches the keyboard package so its background hook listener thread
    attaches to the 'Default' interactive desktop before calling SetWindowsHookEx.
    """
    try:
        import keyboard._winkeyboard as w
        if hasattr(w, "listen") and not getattr(w, "_desktop_patched", False):
            orig_listen = w.listen
            def patched_listen(callback):
                ensure_default_desktop()
                return orig_listen(callback)
            w.listen = patched_listen
            w._desktop_patched = True
            logging.info("[DesktopUtils] Successfully patched keyboard._winkeyboard to Default desktop.")
    except Exception as e:
        logging.warning(f"[DesktopUtils] Could not patch keyboard library: {e}")
