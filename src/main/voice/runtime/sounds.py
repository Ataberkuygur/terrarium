import threading
import winsound


def play_start_sound():
    def _run():
        try:
            # 880 Hz (A5), 70ms crisp high chime
            winsound.Beep(880, 70)
        except Exception:
            pass
    threading.Thread(target=_run, daemon=True).start()


def play_stop_sound():
    def _run():
        try:
            # 587 Hz (D5), 80ms crisp low chime
            winsound.Beep(587, 80)
        except Exception:
            pass
    threading.Thread(target=_run, daemon=True).start()


def play_success_sound():
    def _run():
        try:
            # Quick 2-tone success pip
            winsound.Beep(784, 50)
            winsound.Beep(1046, 70)
        except Exception:
            pass
    threading.Thread(target=_run, daemon=True).start()


def play_error_sound():
    def _run():
        try:
            winsound.Beep(330, 150)
        except Exception:
            pass
    threading.Thread(target=_run, daemon=True).start()
