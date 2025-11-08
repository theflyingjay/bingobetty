# 🎉 BettyBot Bingo  
> **“Bingo made simple — for everyone.”**  
> Voice-activated, senior-friendly, automated Bingo player built for Raspberry Pi.

### 🧠 Overview

**BettyBot** is an intelligent **automated Bingo assistant** that listens to live Bingo calls, marks cards automatically, speaks feedback, and helps visually impaired or elderly players enjoy Bingo independently.

It runs entirely **offline** on a Raspberry Pi using [whisper.cpp](https://github.com/ggerganov/whisper.cpp) for speech recognition and a touchscreen Flask UI.

---

### 🧩 Key Features

✅ Real-time Bingo call recognition (offline Whisper model)  
✅ Hands-free setup — “How many games tonight?”, “That’s a good bingo!”  
✅ Support for 10+ Bingo game programs (Classic, Hard Ways, Lucky 7, etc.)  
✅ Animated card visualization with tactile-friendly touchscreen interface  
✅ “Winner” sound loop until confirmation  
✅ Adjustable mic gain & speaker volume  
✅ Designed for ReSpeaker Mic Array + USB Speakers  
✅ Custom patterns via `patterns.json`

---

### ⚙️ Hardware Setup

| Component | Example Model | Notes |
|------------|----------------|-------|
| 🎛️ **Raspberry Pi** | 4B / 5 | Runs Flask + whisper.cpp |
| 🎙️ **Mic Array** | Seeed ReSpeaker 4-Mic USB | Captures live bingo calls |
| 🔊 **Speakers** | USB mini speakers | Audio feedback & winner loop |
| 🖥️ **Screen** | 5-inch Pi Touchscreen | Kiosk UI |
| 💽 **Storage** | microSD (32 GB +) | For models & audio assets |

### ⚙️ Installation

# Clone the repository
cd /opt
sudo git clone https://github.com/theflyingjay/bingobetty.git bettybot
cd bettybot

# (Optional) Create Python venv
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install flask flask-sock

# Build whisper.cpp
cd whisper.cpp
make

# Return to app dir
cd /opt/bettybot

### 🔊 Running the App

# Activate environment
cd /opt/bettybot
source venv/bin/activate

# Start Flask app
python3 bingo_app.py

### 🧩 Systemd Service (auto-start at boot)

[Unit]
Description=BettyBot Bingo (Flask UI + Whisper listener)
After=network-online.target sound.target
Wants=network-online.target

[Service]
Type=simple
User=jacob
WorkingDirectory=/opt/bettybot
ExecStart=/opt/bettybot/venv/bin/python /opt/bettybot/bingo_app.py
Restart=always
RestartSec=2
StandardOutput=journal
StandardError=journal
Environment=PYTHONUNBUFFERED=1
Environment=ALSA_DEV=plughw:2,0
Environment=WHISPER_BIN=/opt/bettybot/whisper.cpp/build/bin/whisper-cli
Environment=WHISPER_MODEL=/opt/bettybot/whisper.cpp/models/ggml-tiny.en.bin

[Install]
WantedBy=multi-user.target

### 🎮 Game Modes (More Coming Soon)
| Game                     | Description                                                  |
| ------------------------ | ------------------------------------------------------------ |
| **Classic Bingo**        | Standard line bingo (Free space enabled).                    |
| **Hard Ways Bingo**      | Same as classic but no Free space.                           |
| **Lucky 7**              | Top row + diagonal from top-right to bottom-left.            |
| **Special Number**       | First ball’s digits premark matching numbers, then coverall. |
| **Odds / Evens**         | First ball decides parity; opposite wins coverall.           |
| **Giant X**              | Both diagonals form an X.                                    |
| **Barbell**              | Two 3×3 corners joined by center bar.                        |
| **Five Around Corner**   | Five cells forming an “L” in a corner.                       |
| **Lucky 4**              | A “4” shape: middle row + right column.                      |
| **Six Pack / Nine Pack** | Center 2×3 or 3×3 blocks.                                    |

### 🧠 Future Roadmap

Dynamic Microphone Adjustment
Autodetect Microphone
OCR/Camera Bingo Sheets for games.
And more.