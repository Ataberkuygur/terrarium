import ctypes
from ctypes import wintypes
import queue
import threading
import time
import tkinter as tk
from desktop_utils import ensure_default_desktop

# Enable High DPI awareness so coordinates match real screen pixels on Windows
try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception:
    try:
        ctypes.windll.user32.SetProcessDPIAware()
    except Exception:
        pass

# Win32 Constants
GWL_EXSTYLE = -20
WS_EX_NOACTIVATE = 0x08000000
WS_EX_TOOLWINDOW = 0x00000080
WS_EX_TOPMOST = 0x00000008
HWND_TOPMOST = -1
SWP_NOMOVE = 0x0002
SWP_NOSIZE = 0x0001
SWP_NOACTIVATE = 0x0010
SWP_SHOWWINDOW = 0x0040
SWP_FRAMECHANGED = 0x0020
SPI_GETWORKAREA = 0x0030


class RECT(ctypes.Structure):
    _fields_ = [
        ("left", ctypes.c_long),
        ("top", ctypes.c_long),
        ("right", ctypes.c_long),
        ("bottom", ctypes.c_long),
    ]


def get_work_area():
    rect = RECT()
    ctypes.windll.user32.SystemParametersInfoW(SPI_GETWORKAREA, 0, ctypes.byref(rect), 0)
    w = rect.right - rect.left
    h = rect.bottom - rect.top
    return rect.left, rect.top, w, h, rect.bottom


class OverlayHUD:
    def __init__(self, position: str = "top"):
        self.position = position
        self.queue = queue.Queue()
        self.root = None
        self._ready_event = threading.Event()
        self._thread = threading.Thread(target=self._run_tk, daemon=True)
        self._thread.start()
        self._ready_event.wait(timeout=3.0)

    def _run_tk(self):
        ensure_default_desktop()
        self.root = tk.Tk()
        self.root.overrideredirect(True)
        self.root.attributes("-topmost", True)
        self.root.configure(bg="#090a0c")

        # Floating dark pill container
        self.frame = tk.Frame(
            self.root,
            bg="#121316",
            highlightthickness=1,
            highlightbackground="#ef4444",
            padx=18,
            pady=9,
        )
        self.frame.pack(fill="both", expand=True)

        # Status icon
        self.icon_label = tk.Label(
            self.frame,
            text="🔴",
            font=("Segoe UI", 12),
            fg="#ef4444",
            bg="#121316",
        )
        self.icon_label.pack(side="left", padx=(0, 10))

        # Status text
        self.text_label = tk.Label(
            self.frame,
            text="Listening... [F8]",
            font=("Segoe UI", 11, "bold"),
            fg="#f4f4f5",
            bg="#121316",
        )
        self.text_label.pack(side="left")

        # Initial hidden state
        self.root.withdraw()

        # Apply no-activate style so terminal never loses focus
        self._apply_no_activate()

        self._ready_event.set()
        self._check_queue()
        self.root.mainloop()

    def _get_top_hwnd(self):
        try:
            wid = self.root.winfo_id()
            top_hwnd = ctypes.windll.user32.GetAncestor(wid, 2)  # GA_ROOT = 2
            return top_hwnd if top_hwnd else wid
        except Exception:
            return self.root.winfo_id()

    def _apply_no_activate(self):
        try:
            self.root.update_idletasks()
            hwnd = self._get_top_hwnd()
            user32 = ctypes.windll.user32
            style = user32.GetWindowLongW(hwnd, GWL_EXSTYLE)
            user32.SetWindowLongW(
                hwnd,
                GWL_EXSTYLE,
                style | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW | WS_EX_TOPMOST,
            )
            user32.SetWindowPos(
                hwnd,
                HWND_TOPMOST,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_FRAMECHANGED,
            )
        except Exception as e:
            print(f"[Overlay] Window style error: {e}")

    def _position_window(self):
        self.root.update_idletasks()
        w = self.root.winfo_reqwidth()
        h = self.root.winfo_reqheight()

        left, top, work_w, work_h, work_bottom = get_work_area()

        x = left + (work_w - w) // 2
        if self.position == "bottom":
            y = work_bottom - h - 50  # comfortably above Windows taskbar
        else:
            y = top + 45  # Top center (Dynamic Island)

        self.root.geometry(f"+{x}+{y}")

        # Ensure top-most without taking focus
        try:
            hwnd = self._get_top_hwnd()
            ctypes.windll.user32.SetWindowPos(
                hwnd,
                HWND_TOPMOST,
                x,
                y,
                w,
                h,
                SWP_NOACTIVATE | SWP_SHOWWINDOW,
            )
        except Exception:
            pass

    def _check_queue(self):
        try:
            while not self.queue.empty():
                action, payload = self.queue.get_nowait()
                if action == "show_listening":
                    hotkey = payload.get("hotkey", "F9").upper()
                    self.icon_label.config(text="🔴", fg="#ef4444")
                    self.text_label.config(text=f"Listening... [{hotkey} to stop]", fg="#f4f4f5")
                    self.frame.config(highlightbackground="#ef4444")
                    self._position_window()
                    self.root.deiconify()
                    self.root.lift()

                elif action == "show_listened":
                    self.icon_label.config(text="🎧", fg="#38bdf8")
                    self.text_label.config(text="Listened", fg="#e0f2fe")
                    self.frame.config(highlightbackground="#38bdf8")
                    self._position_window()
                    self.root.deiconify()
                    self.root.lift()

                elif action == "show_transcribing":
                    self.icon_label.config(text="⚡", fg="#f59e0b")
                    self.text_label.config(text="Transcribing...", fg="#fef3c7")
                    self.frame.config(highlightbackground="#f59e0b")
                    self._position_window()
                    self.root.deiconify()
                    self.root.lift()

                elif action == "show_pasted":
                    self.icon_label.config(text="✓", fg="#10b981")
                    self.text_label.config(text="Pasted!", fg="#d1fae5")
                    self.frame.config(highlightbackground="#10b981")
                    self._position_window()
                    self.root.deiconify()
                    self.root.lift()
                    self.root.after(850, self._safe_withdraw)

                elif action == "show_error":
                    msg = payload.get("message", "No speech detected")
                    self.icon_label.config(text="✕", fg="#f43f5e")
                    self.text_label.config(text=msg, fg="#ffe4e6")
                    self.frame.config(highlightbackground="#f43f5e")
                    self._position_window()
                    self.root.deiconify()
                    self.root.lift()
                    self.root.after(1400, self._safe_withdraw)

                elif action == "hide":
                    self.root.withdraw()

        except Exception as e:
            print(f"[Overlay] Queue error: {e}")

        if self.root:
            self.root.after(25, self._check_queue)

    def _safe_withdraw(self):
        if self.root:
            self.root.withdraw()

    def show_recording(self, hotkey: str = "F8"):
        """Alias for show_listening."""
        self.show_listening(hotkey=hotkey)

    def show_listening(self, hotkey: str = "F8"):
        self.queue.put(("show_listening", {"hotkey": hotkey}))

    def show_listened(self):
        self.queue.put(("show_listened", {}))

    def show_transcribing(self):
        self.queue.put(("show_transcribing", {}))

    def show_pasted(self):
        self.queue.put(("show_pasted", {}))

    def show_error(self, message: str = "No speech detected"):
        self.queue.put(("show_error", {"message": message}))

    def hide(self):
        self.queue.put(("hide", {}))
