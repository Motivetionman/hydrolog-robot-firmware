#include <Bluepad32.h>

// ==========================================
// การกำหนดขาต่อใช้งาน (Pin Configurations) สำหรับชิป TB67H450
// ==========================================
const int PIN_L_IN1 = 25;
const int PIN_L_IN2 = 26;

const int PIN_R_IN1 = 14;
const int PIN_R_IN2 = 12;

const int PIN_BRUSH_RELAY = 19; // ต่อผ่าน Relay หรือ MOSFET เพื่อเปิด-ปิดแปรงปัด (Active LOW)

// การตั้งค่า PWM Channel ของ ESP32 สำหรับมอเตอร์ล้อ
const int freq = 5000;
const int resolution = 8; // ความละเอียด 8 บิต (0-255)

const int ch_L_IN1 = 0;
const int ch_L_IN2 = 1;
const int ch_R_IN1 = 2;
const int ch_R_IN2 = 3;

// ==========================================
// การตั้งค่าสำหรับ 2-DOF Pan-Tilt Servo (ควบคุมมุมกล้องด้วย LEDC 16-bit)
// ==========================================
// 1. แกน Tilt (ก้ม-เงย)
const int PIN_SERVO_TILT = 13;
const int ch_SERVO_TILT = 4;

// 2. แกน Pan (กวาดซ้าย-ขวา) - ย้ายมาใช้ GPIO 21 แทน Stepper เดิม
const int PIN_SERVO_PAN = 21;
const int ch_SERVO_PAN = 5;

const int freq_SERVO = 50;  // ความถี่มาตรฐานเซอร์โว 50Hz (คาบเวลา 20ms)
const int res_SERVO = 16;   // ความละเอียด 16 บิต (0-65535)

// ตัวแปรเก็บมุมปัจจุบัน (เริ่มต้นที่ 90 องศา - ตรงกลาง)
int servoTiltAngle = 90;
int servoPanAngle = 90;

unsigned long lastServoUpdate = 0;
const unsigned long SERVO_STEP_INTERVAL = 15; // อัปเดตมุมทุก 15ms เพื่อความนุ่มนวล

// ==========================================
// ตัวแปรควบคุมระบบ
// ==========================================
int roomNumber = 101; 
bool brushState = false; 
unsigned long lastButtonPress = 0;
const int DEBOUNCE_TIME = 250; 

bool isPS4Moving = false;
bool wasPS4Connected = false;

// Serial Drive Watchdog (ป้องกันรถวิ่งเตลิดถ้า Pi 5 หลุดการสื่อสาร)
unsigned long lastSerialDriveTime = 0;
const unsigned long SERIAL_DRIVE_TIMEOUT = 500; // ms

// ตัวแปรสำหรับ Bluepad32
ControllerPtr myControllers[BP32_MAX_GAMEPADS];

// ==========================================
// ฟังก์ชันควบคุมมุม Servo (แปลงองศาเป็นสัญญาณ 16-bit Duty Cycle)
// ==========================================
void setServoTilt(int angle) {
  servoTiltAngle = constrain(angle, 10, 170); // ล็อคช่วงมุมที่ปลอดภัยกันเซอร์โวติดขัด
  // 50Hz คาบเวลาคือ 20ms (20000us) ที่ความละเอียด 16 บิต (65535)
  // 0.5ms (0 องศา) = 1638 duty | 2.5ms (180 องศา) = 8192 duty
  int duty = map(servoTiltAngle, 0, 180, 1638, 8192);
  ledcWrite(ch_SERVO_TILT, duty);
}

void setServoPan(int angle) {
  servoPanAngle = constrain(angle, 0, 180);
  int duty = map(servoPanAngle, 0, 180, 1638, 8192);
  ledcWrite(ch_SERVO_PAN, duty);
}

// ==========================================
// ฟังก์ชันจัดตำแหน่งกล้องก้มเงยอัตโนมัติก่อนส่งคำสั่งถ่ายรูป
// ==========================================
void triggerPhoto(bool isWater) {
  // นำรถหยุดสนิททันทีก่อนถ่ายภาพ เพื่อป้องกันภาพเบลอจากการเคลื่อนที่ (Edge Case 1.2 Motion Blur)
  driveDifferential(0, 0);
  isPS4Moving = false;

  if (isWater) {
    Serial.println("Auto Positioning Camera for WATER Meter...");
    setServoTilt(45); // ปรับองศาก้มลงถ่ายมิเตอร์น้ำ
    delay(400);       // รอเซอร์โวเคลื่อนที่เข้าตำแหน่ง
    Serial.println("Triggering WATER Meter Photo via UART to Pi 5");
    Serial2.print("WATER:" + String(roomNumber) + "\n");
  } else {
    Serial.println("Auto Positioning Camera for ELECTRICITY Meter...");
    setServoTilt(135); // ปรับองศาเงยขึ้นถ่ายมิเตอร์ไฟ
    delay(400);        // รอเซอร์โวเคลื่อนที่เข้าตำแหน่ง
    Serial.println("Triggering ELECTRICITY Meter Photo via UART to Pi 5");
    Serial2.print("ELEC:" + String(roomNumber) + "\n");
  }
  delay(600);         // ให้เวลากล้อง Pi 5 ล็อคชัตเตอร์และรับแสงภาพอย่างสมบูรณ์
  setServoTilt(servoTiltAngle); // หมุนกลับมาที่มุมแมนนวลเดิมของพลปืน
}

// ==========================================
// Callback เมื่อจอยเชื่อมต่อ / ตัดการเชื่อมต่อ
// ==========================================
void onConnectedController(ControllerPtr ctl) {
  for (int i = 0; i < BP32_MAX_GAMEPADS; i++) {
    if (myControllers[i] == nullptr) {
      Serial.printf("🎮 Controller [%d] Connected!\n", i + 1);
      myControllers[i] = ctl;
      break;
    }
  }
}

void onDisconnectedController(ControllerPtr ctl) {
  for (int i = 0; i < BP32_MAX_GAMEPADS; i++) {
    if (myControllers[i] == ctl) {
      Serial.printf("🔌 Controller [%d] Disconnected\n", i + 1);
      myControllers[i] = nullptr;
      break;
    }
  }
}

// ==========================================
// ฟังก์ชันกำหนดทิศทางและความเร็วมอเตอร์ล้อขับเคลื่อน
// ==========================================
void setMotorTB67(int ch_in1, int ch_in2, int speed) {
  speed = constrain(speed, -255, 255);
  if (speed > 10) { 
    ledcWrite(ch_in1, speed);
    ledcWrite(ch_in2, 0);
  } else if (speed < -10) { 
    ledcWrite(ch_in1, 0);
    ledcWrite(ch_in2, abs(speed));
  } else { 
    ledcWrite(ch_in1, 0);
    ledcWrite(ch_in2, 0);
  }
}

void driveDifferential(int y, int z) {
  int speed_L = y + z;
  int speed_R = y - z;
  setMotorTB67(ch_L_IN1, ch_L_IN2, speed_L);
  setMotorTB67(ch_R_IN1, ch_R_IN2, speed_R);
}

void printRoomStatus() {
  Serial.printf(">>> 🚪 Selected Room: %d (Floor %d, Room %02d) <<<\n", roomNumber, roomNumber / 100, roomNumber % 100);
}

// ==========================================
// Setup
// ==========================================
void setup() {
  Serial.begin(115200);
  // พอร์ตสื่อสาร Serial2 สำหรับคุยกับ Raspberry Pi 5 (RX2=GPIO 16, TX2=GPIO 17)
  Serial2.begin(115200, SERIAL_8N1, 16, 17);
  Serial2.setTimeout(10); // ป้องกันบอร์ดค้างเวลามีสัญญาณรบกวน
  
  pinMode(16, INPUT_PULLUP); // ป้องกัน Floating Pin ตอนยังไม่ต่อสาย

  pinMode(PIN_BRUSH_RELAY, OUTPUT);
  digitalWrite(PIN_BRUSH_RELAY, HIGH); // Active LOW: เริ่มต้นจ่าย HIGH เพื่อ "ปิด" แปรงปัด

  // ตั้งค่า PWM สำหรับมอเตอร์ล้อขับเคลื่อน
  ledcSetup(ch_L_IN1, freq, resolution);
  ledcAttachPin(PIN_L_IN1, ch_L_IN1);
  ledcSetup(ch_L_IN2, freq, resolution);
  ledcAttachPin(PIN_L_IN2, ch_L_IN2);
  ledcSetup(ch_R_IN1, freq, resolution);
  ledcAttachPin(PIN_R_IN1, ch_R_IN1);
  ledcSetup(ch_R_IN2, freq, resolution);
  ledcAttachPin(PIN_R_IN2, ch_R_IN2);

  // ตั้งค่า PWM สำหรับ 2-DOF Pan-Tilt Servo
  ledcSetup(ch_SERVO_TILT, freq_SERVO, res_SERVO);
  ledcAttachPin(PIN_SERVO_TILT, ch_SERVO_TILT);
  setServoTilt(servoTiltAngle); // มุมเริ่มต้นก้มเงย 90 องศา (ระนาบตรง)

  ledcSetup(ch_SERVO_PAN, freq_SERVO, res_SERVO);
  ledcAttachPin(PIN_SERVO_PAN, ch_SERVO_PAN);
  setServoPan(servoPanAngle);   // มุมเริ่มต้นหันซ้ายขวา 90 องศา (หันตรง)

  // เริ่มต้นระบบ Bluepad32
  BP32.setup(&onConnectedController, &onDisconnectedController);

  Serial.println("=================================================");
  Serial.println("🤖 ESP32 Main Drive Ready (2-DOF Pan-Tilt + Pi 5 UART)");
  Serial.println("🎮 Left Stick: Drive & Steer | Right Stick: 2-DOF Camera");
  Serial.println("=================================================");
  printRoomStatus();
}

// ==========================================
// Main Loop
// ==========================================
void loop() {
  BP32.update();

  ControllerPtr driverGamepad = myControllers[0];
  
  if (driverGamepad && driverGamepad->isConnected()) {
    wasPS4Connected = true;
    
    // ----------------------------------------------------
    // 1. บังคับล้อรถ (ก้านอนาล็อกซ้าย: Y=เดินหน้า/ถอยหลัง, X=เลี้ยวซ้าย/ขวา)
    // ----------------------------------------------------
    int translation = -(driverGamepad->axisY()) / 2; 
    int rotation = (driverGamepad->axisX()) / 2;    
    
    if (abs(translation) < 20) translation = 0;
    if (abs(rotation) < 20) rotation = 0;
    
    if (translation != 0 || rotation != 0) {
      driveDifferential(translation, rotation);
      isPS4Moving = true;
    } 
    else if (isPS4Moving) {
      driveDifferential(0, 0);
      isPS4Moving = false;
    }
    
    // ----------------------------------------------------
    // 2. ควบคุมปุ่มกด (แปรงปัด, ห้อง, ถ่ายภาพ)
    // ----------------------------------------------------
    if (millis() - lastButtonPress > DEBOUNCE_TIME) {
      // ปุ่ม R1: เปิด-ปิดแปรงปัด (Active LOW Relay)
      if (driverGamepad->r1()) {
        brushState = !brushState;
        digitalWrite(PIN_BRUSH_RELAY, brushState ? LOW : HIGH);
        Serial.println(brushState ? "🧹 Roller Brush: ON" : "🧹 Roller Brush: OFF");
        lastButtonPress = millis();
      }

      // ปุ่ม D-Pad: เปลี่ยนห้องพัก 5 ชั้น 50 ห้อง (101-510)
      uint16_t dpad = driverGamepad->dpad();
      if (dpad != 0) {
        int floor = roomNumber / 100;
        int roomInFloor = roomNumber % 100;
        bool roomChanged = false;

        // UP: ห้องถัดไป (101 -> 102 ... 110 -> 201)
        if (dpad & 0x01) { 
          roomInFloor++;
          if (roomInFloor > 10) {
            roomInFloor = 1;
            floor = (floor >= 5) ? 1 : floor + 1;
          }
          roomChanged = true;
        }
        // DOWN: ห้องก่อนหน้า (201 -> 110 ... 102 -> 101)
        else if (dpad & 0x02) { 
          roomInFloor--;
          if (roomInFloor < 1) {
            roomInFloor = 10;
            floor = (floor <= 1) ? 5 : floor - 1;
          }
          roomChanged = true;
        }
        // RIGHT: กระโดดขึ้นชั้นถัดไปทันที (เช่น 102 -> 202)
        else if (dpad & 0x04) { 
          floor = (floor >= 5) ? 1 : floor + 1;
          roomChanged = true;
        }
        // LEFT: กระโดดลงชั้นก่อนหน้าทันที (เช่น 302 -> 202)
        else if (dpad & 0x08) { 
          floor = (floor <= 1) ? 5 : floor - 1;
          roomChanged = true;
        }

        if (roomChanged) {
          roomNumber = floor * 100 + roomInFloor;
          printRoomStatus();
          lastButtonPress = millis();
        }
      }

      // ปุ่ม X (Square): ถ่ายภาพมิเตอร์น้ำ | ปุ่ม Y (Triangle/Cross): ถ่ายภาพมิเตอร์ไฟ
      if (driverGamepad->x()) { triggerPhoto(true); lastButtonPress = millis(); }
      if (driverGamepad->y()) { triggerPhoto(false); lastButtonPress = millis(); }
    }

    // ----------------------------------------------------
    // 3. ควบคุมมุมกล้อง 2-DOF Pan-Tilt (ก้านอนาล็อกขวา: RX=หันซ้ายขวา, RY=ก้มเงย)
    // ----------------------------------------------------
    int panStick = driverGamepad->axisRX(); 
    int tiltStick = driverGamepad->axisRY(); 

    if (abs(panStick) > 50 || abs(tiltStick) > 50) {
      unsigned long currentMillis = millis();
      if (currentMillis - lastServoUpdate >= SERVO_STEP_INTERVAL) { 
        // กวาดซ้าย-ขวา (Pan)
        if (panStick > 50) servoPanAngle = constrain(servoPanAngle + 1, 0, 180);
        else if (panStick < -50) servoPanAngle = constrain(servoPanAngle - 1, 0, 180);
        setServoPan(servoPanAngle);

        // ก้ม-เงย (Tilt)
        if (tiltStick < -50) servoTiltAngle = constrain(servoTiltAngle + 1, 10, 170); // ก้ม
        else if (tiltStick > 50) servoTiltAngle = constrain(servoTiltAngle - 1, 10, 170); // เงย
        setServoTilt(servoTiltAngle);

        lastServoUpdate = currentMillis;
      }
    }

  } else {
    // Failsafe: จอยหลุดการเชื่อมต่อ ให้หยุดรถและปิดแปรงปัดทันที
    if (wasPS4Connected) {
      driveDifferential(0, 0);
      digitalWrite(PIN_BRUSH_RELAY, HIGH); // ปิดแปรงปัด
      brushState = false;                  // ซิงค์สถานะตัวแปรให้ตรงกับฮาร์ดแวร์
      wasPS4Connected = false;
      isPS4Moving = false;
    }
  }

  // ----------------------------------------------------
  // 4. ตรวจสอบคำสั่งจาก Raspberry Pi 5 / Web UI ผ่าน UART (Serial2)
  // ----------------------------------------------------
  if (Serial2.available() > 0) {
    String piResponse = Serial2.readStringUntil('\n');
    piResponse.trim();
    
    if (piResponse.startsWith("DRIVE:")) {
      String payload = piResponse.substring(6);
      int commaIdx = payload.indexOf(',');
      if (commaIdx != -1) {
        int y = payload.substring(0, commaIdx).toInt();
        int z = payload.substring(commaIdx + 1).toInt();
        if (!isPS4Moving) {
          driveDifferential(y, z);
          lastSerialDriveTime = millis(); // บันทึกเวลารับคำสั่งล่าสุดสำหรับ Watchdog
        }
      }
    } 
    else if (piResponse.startsWith("BRUSH:")) {
      String payload = piResponse.substring(6);
      brushState = (payload.toInt() == 1);
      digitalWrite(PIN_BRUSH_RELAY, brushState ? LOW : HIGH);
      Serial.println(brushState ? "🧹 Roller Brush (via Web): ON" : "🧹 Roller Brush (via Web): OFF");
    }
    else if (piResponse.startsWith("TILT:")) {
      int dir = piResponse.substring(5).toInt();
      servoTiltAngle = constrain(servoTiltAngle + (dir * 5), 10, 170);
      setServoTilt(servoTiltAngle);
      Serial.println("📐 Servo Tilt (via Web): " + String(servoTiltAngle) + " deg");
    }
    else if (piResponse.startsWith("PAN:")) {
      int dir = piResponse.substring(4).toInt();
      servoPanAngle = constrain(servoPanAngle + (dir * 5), 0, 180);
      setServoPan(servoPanAngle);
      Serial.println("📐 Servo Pan (via Web): " + String(servoPanAngle) + " deg");
    }
    else if (piResponse.startsWith("ROOM_SET_FROM_WEB:")) {
      roomNumber = piResponse.substring(18).toInt();
      Serial.printf(">>> 🚪 Room Synced from Web: %d <<<\n", roomNumber);
    }
    else if (piResponse.startsWith("AUTOPOS:")) {
      String pos = piResponse.substring(8);
      if (pos == "WATER") {
        Serial.println("Auto Positioning Camera for WATER Meter (Web Command)...");
        setServoTilt(45);
      } else if (pos == "ELEC") {
        Serial.println("Auto Positioning Camera for ELECTRICITY Meter (Web Command)...");
        setServoTilt(135);
      } else if (pos == "RESET") {
        Serial.println("Resetting Camera Angle back to operator setting");
        setServoTilt(servoTiltAngle);
        setServoPan(servoPanAngle);
      }
    }
    else {
      if (piResponse.length() > 0) {
        Serial.println("[Pi 5 Response]: " + piResponse);
      }
    }
  }

  // ----------------------------------------------------
  // 5. Watchdog ป้องกันรถวิ่งเตลิด (Serial Drive Watchdog)
  // ----------------------------------------------------
  // หากกำลังขับด้วยคำสั่งจาก Web/Pi 5 (จอยไม่ได้แตะ) แต่ไม่ได้รับคำสั่ง DRIVE มาเกิน 500ms ให้หยุดรถทันที
  if (!isPS4Moving && lastSerialDriveTime > 0 && (millis() - lastSerialDriveTime > SERIAL_DRIVE_TIMEOUT)) {
    driveDifferential(0, 0);
    lastSerialDriveTime = 0;
    Serial.println("⚠️ [Watchdog]: Serial Drive Timeout! Motors Stopped for Safety.");
  }
  
  delay(1); // ลดภาระ CPU และ Yield ให้กับ FreeRTOS Background Tasks
}
