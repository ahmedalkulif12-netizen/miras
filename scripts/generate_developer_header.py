import os
from PIL import Image

TARGET_WIDTH = 4096
TARGET_HEIGHT = 2304
INPUT_NAMES = {
    "صورة-الميزة-1024x500.png",
    "صورة-الميزة-1024x500.jpg",
    "صورة-الميزة-1024x500.jpeg",
}


def real_desktop() -> str:
    """Windows Desktop, including the OneDrive folder when that is the real Desktop."""
    try:
        import ctypes

        buffer = ctypes.create_unicode_buffer(32767)
        # CSIDL_DESKTOPDIRECTORY
        if ctypes.windll.shell32.SHGetFolderPathW(None, 0x0010, None, 0, buffer) == 0 and buffer.value:
            return buffer.value
    except Exception:
        pass
    return os.path.join(os.path.expanduser("~"), "Desktop")


def find_input(desktop_path: str) -> str | None:
    home = os.path.expanduser("~")
    candidates = [
        os.path.join(desktop_path, "صورة-الميزة-1024x500.png"),
        os.path.join(desktop_path, "صورة-الميزة-1024x500.jpg"),
        os.path.join(home, "OneDrive", "Desktop", "صورة-الميزة-1024x500.png"),
        os.path.join(os.getcwd(), "صورة-الميزة-1024x500.png"),
        os.path.join(os.getcwd(), "صورة-الميزة-1024x500.jpg"),
    ]
    for path in candidates:
        if os.path.isfile(path):
            return path

    roots = []
    for root in (desktop_path, os.getcwd()):
        if root and os.path.isdir(root) and root not in roots:
            roots.append(root)

    for root in roots:
        for dirpath, _dirnames, filenames in os.walk(root):
            for name in filenames:
                if name in INPUT_NAMES:
                    return os.path.join(dirpath, name)
    return None


def generate_developer_header() -> None:
    desktop_path = real_desktop()
    output_banner_path = os.path.join(desktop_path, "developer_header_4096x2304.png")
    input_path = find_input(desktop_path)
    if not input_path:
        print("Input file not found on Desktop.")
        return

    with Image.open(input_path) as img:
        img = img.convert("RGB")
        resized_img = img.resize((TARGET_WIDTH, TARGET_HEIGHT), Image.Resampling.LANCZOS)
        resized_img.save(output_banner_path, format="PNG")
        print(f"Source: {input_path}")
        print(f"Saved developer header to: {output_banner_path}")
        print(f"Size: {resized_img.size[0]}x{resized_img.size[1]} mode={resized_img.mode}")


if __name__ == "__main__":
    generate_developer_header()
