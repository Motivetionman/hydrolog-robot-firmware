# 🤖 HydroLog - Cleaning & Meter-Logging Robot Firmware

Firmware and hardware documentation for the **Autonomous/Teleoperated 2-Wheel Drive Cleaning & Meter-Logging Robot** (Project 392_2026).

---

> [!CAUTION]
> ### 🛑 กฎเหล็กเรื่อง Git & GitHub (Strict Git Policy for AI Agents)
> **ถ้า User ไม่ได้สั่ง ห้ามเอาโค้ดขึ้น GitHub เด็ดขาด!**
> Do NOT commit or push any code to GitHub unless the user explicitly commands it.

---

## 🔗 Related Repositories
- 🌐 **Web Dashboard & Analytics App:** [Motivetionman/hydrolog-smart-water-tracker](https://github.com/Motivetionman/hydrolog-smart-water-tracker)

---

## 📁 Project Structure
```text
.
├── ESP32_CAM_Vision/        # ESP32-CAM (AI-Thinker): MJPEG live stream, camera tilt servo, and photo capture
│   └── ESP32_CAM_Vision.ino
├── ESP32_Main_Drive/        # ESP32 Main MCU: PS4 Bluetooth controller, TB67H450 motor driver, roller brush, melody buzzer
│   └── ESP32_Main_Drive.ino
├── Code.gs                  # Google Apps Script webhook for image saving, OCR logging, and Line Bot notifications
├── backlog.md               # Task backlog, feature roadmap, and credentials
├── component_specification.md # Detailed hardware pinout, electrical specs, and calculations
├── physical_components.md   # Bill of materials and physical component list
└── loveable_prompt.md       # Prompt template for Loveable web dashboard generation
```

---

## 🎮 Controller Layout (PS4 DualShock 4)
- **Left Stick (Y):** Drive Forward / Backward
- **Right Stick (X):** Steer Left / Right
- **D-Pad Up / Down:** Change Room Number (+1 / -1)
- **D-Pad Right / Left:** Change Floor / Jump 10 Rooms (+10 / -10)
- **Square (⏹️):** Trigger Water Meter Capture
- **Triangle (🔺):** Trigger Electricity Meter Capture
- **R1:** Toggle Roller Brush ON/OFF (with soft melody buzzer)
