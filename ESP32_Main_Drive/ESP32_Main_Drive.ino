#include <PS4Controller.h>

// ==========================================
// การกำหนดขาต่อใช้งาน (Pin Configurations) สำหรับชิป TB67H450
// ==========================================
const int PIN_L_IN1 = 25;
const int PIN_L_IN2 = 26;

const int PIN_R_IN1 = 14;
const int PIN_R_IN2 = 12;

// 3. ขาสำหรับคุมมอเตอร์แปรงปัดกวาด (Roller Brush)
const int PIN_BRUSH_RELAY = 19; // ต่อผ่าน Relay หรือ MOSFET เพื่อเปิด-ปิดแปรงปัด

// 4. ขาสำหรับต่อกับ Passive Buzzer แจ้งเตือนคนเดินผ่าน
const int PIN_BUZZER = 18; // ใช้ขา GPIO 18 (รองรับ PWM)

// 5. การตั้งค่า PWM Channel ของ ESP32 
// (สำหรับ TB67H450 ต้องใช้ 4 ช่อง เพราะต้องสลับจ่าย PWM ใหักับ IN1 และ IN2 ของล้อซ้ายและขวา)
const int freq = 5000;
const int resolution = 8; // ความละเอียด 8 บิต (0-255)
const int ch_L_IN1 = 0;
const int ch_L_IN2 = 1;
const int ch_R_IN1 = 2;
const int ch_R_IN2 = 3;

// ==========================================
// ตัวแปรควบคุมระบบ
// ==========================================
int roomNumber = 101; // เลขห้องเริ่มต้น
bool brushState = false; // สถานะแปรงปัด (เปิด/ปิด)
unsigned long lastButtonPress = 0;
const int DEBOUNCE_TIME = 250; // หน่วงเวลากันกดปุ่มซ้ำ (มิลลิวินาที)

// ==========================================
// ตัวแปรและฟังก์ชันสำหรับเสียงเมโลดี้เตือนแบบ Non-Blocking
// ==========================================
// เมโลดี้เสียงเตือนเบาๆ (โน้ตเพลง Do-Mi-Sol-Do สูงขึ้นเรื่อยๆ แล้ววนลูป)
int melody[] = { 262, 330, 392, 523, 392, 330 }; // C4, E4, G4, C5, G4, E4 arpeggio
int noteDurations[] = { 150, 150, 150, 200, 150, 150 }; // ระยะเวลาเล่นโน้ตแต่ละตัว (มิลลิวินาที)
int currentNote = 0;
unsigned long previousNoteTime = 0;
bool isBuzzerPlaying = false;

void playMelodyNonBlocking() {
  if (!brushState) {
    noTone(PIN_BUZZER);
    isBuzzerPlaying = false;
    currentNote = 0; // รีเซ็ตกลับไปโน้ตตัวแรกสุด
    return;
  }
  
  unsigned long currentMillis = millis();
  int noteDuration = noteDurations[currentNote];
  int pauseBetweenNotes = noteDuration * 1.30; // หน่วงช่องว่างระหว่างโน้ต 30%
  
  if (!isBuzzerPlaying || (currentMillis - previousNoteTime >= pauseBetweenNotes)) {
    noTone(PIN_BUZZER);
    // เล่นโน้ตตัวถัดไปโดยไม่หน่วงเวลา (Non-blocking)
    tone(PIN_BUZZER, melody[currentNote], noteDuration);
    previousNoteTime = currentMillis;
    currentNote = (currentNote + 1) % (sizeof(melody) / sizeof(melody[0]));
    isBuzzerPlaying = true;
  }
}

// ตัวแปรสำหรับเช็กว่า PS4 กำลังบังคับมอเตอร์อยู่หรือไม่ (เพื่อสลับสิทธิ์ให้ Web UI ทำงานได้)
bool isPS4Moving = false;
bool wasPS4Connected = false;

// ==========================================
// ฟังก์ชันกำหนดทิศทางและความเร็วมอเตอร์ (สำหรับ TB67H450 โดยเฉพาะ)
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

// ==========================================
// ฟังก์ชันคำนวณทิศทางการเคลื่อนที่ล้อ Differential Drive (2 ล้อ)
// ==========================================
void driveDifferential(int y, int z) {
  int speed_L = y + z;
  int speed_R = y - z;
  setMotorTB67(ch_L_IN1, ch_L_IN2, speed_L);
  setMotorTB67(ch_R_IN1, ch_R_IN2, speed_R);
}

void setup() {
  Serial.begin(115200);
  
  // เริ่มต้น Serial2 สำหรับคุยกับ ESP32-CAM (Rx2 = Pin 16, Tx2 = Pin 17)
  Serial2.begin(115200, SERIAL_8N1, 16, 17);
  
  pinMode(PIN_BRUSH_RELAY, OUTPUT);
  digitalWrite(PIN_BRUSH_RELAY, LOW);
  
  pinMode(PIN_BUZZER, OUTPUT);
  noTone(PIN_BUZZER);

  ledcSetup(ch_L_IN1, freq, resolution);
  ledcAttachPin(PIN_L_IN1, ch_L_IN1);
  ledcSetup(ch_L_IN2, freq, resolution);
  ledcAttachPin(PIN_L_IN2, ch_L_IN2);
  ledcSetup(ch_R_IN1, freq, resolution);
  ledcAttachPin(PIN_R_IN1, ch_R_IN1);
  ledcSetup(ch_R_IN2, freq, resolution);
  ledcAttachPin(PIN_R_IN2, ch_R_IN2);

  PS4.begin("e8:9e:b4:0b:35:10"); 
  Serial.println("ESP32 Main Drive Ready (Redundant Mode). Waiting for PS4 or Web UI commands...");
}

void loop() {
  // 1. ตรวจสอบจอย PS4 (ฝั่งพลขับ)
  if (PS4.isConnected()) {
    wasPS4Connected = true;
    
    int translation = PS4.LStickY() * 2; 
    int rotation = PS4.RStickX() * 2;    
    
    if (abs(translation) < 20) translation = 0;
    if (abs(rotation) < 20) rotation = 0;
    
    // ระบบแบ่งปันการขับ (Redundant Control)
    // ถ้าจอย PS4 ถูกดัน จะส่งคำสั่งไปที่มอเตอร์ทันที
    if (translation != 0 || rotation != 0) {
      driveDifferential(translation, rotation);
      isPS4Moving = true;
    } 
    // ถ้าจอย PS4 ถูกปล่อยกลับมาตรงกลาง จะสั่งหยุดมอเตอร์แค่ 1 ครั้ง และคืนสิทธิ์ให้ Web UI
    else if (isPS4Moving) {
      driveDifferential(0, 0);
      isPS4Moving = false;
    }
    
    if (millis() - lastButtonPress > DEBOUNCE_TIME) {
      if (PS4.R1()) {
        brushState = !brushState;
        digitalWrite(PIN_BRUSH_RELAY, brushState ? HIGH : LOW);
        Serial.println(brushState ? "Roller Brush: ON" : "Roller Brush: OFF");
        lastButtonPress = millis();
      }
      
      if (PS4.Up()) { roomNumber++; printRoomStatus(); lastButtonPress = millis(); }
      if (PS4.Down()) { if (roomNumber > 1) roomNumber--; printRoomStatus(); lastButtonPress = millis(); }
      if (PS4.Right()) { roomNumber += 10; printRoomStatus(); lastButtonPress = millis(); }
      if (PS4.Left()) { if (roomNumber > 10) roomNumber -= 10; printRoomStatus(); lastButtonPress = millis(); }
      
      if (PS4.Square()) {
        Serial.println("Trigger (PS4): WATER Meter Photo");
        Serial2.print("WATER:" + String(roomNumber) + "\n");
        lastButtonPress = millis();
      }
      if (PS4.Triangle()) {
        Serial.println("Trigger (PS4): ELECTRICITY Meter Photo");
        Serial2.print("ELEC:" + String(roomNumber) + "\n");
        lastButtonPress = millis();
      }
    }
  } else {
    // ถ้าจอย PS4 หลุด ให้หยุดรถแค่ 1 ครั้งเพื่อความปลอดภัย แล้วเปิดทางให้ Web UI ทำงานต่อ
    if (wasPS4Connected) {
      driveDifferential(0, 0);
      digitalWrite(PIN_BRUSH_RELAY, LOW);
      wasPS4Connected = false;
      isPS4Moving = false;
    }
  }
  
  // 2. ตรวจสอบคำสั่งจาก ESP32-CAM (ฝั่งพลปืน / Web UI)
  if (Serial2.available() > 0) {
    String camResponse = Serial2.readStringUntil('\n');
    camResponse.trim();
    
    // คำสั่งขับเคลื่อนจาก Web UI (DRIVE:y,z)
    if (camResponse.startsWith("DRIVE:")) {
      String payload = camResponse.substring(6);
      int commaIdx = payload.indexOf(',');
      if(commaIdx != -1) {
          int y = payload.substring(0, commaIdx).toInt();
          int z = payload.substring(commaIdx+1).toInt();
          // ยอมให้ Web UI สั่งขับรถได้ ก็ต่อเมื่อจอย PS4 ไม่ได้ขยับอยู่เท่านั้น
          if (!isPS4Moving) {
            driveDifferential(y, z);
          }
      }
    } 
    // คำสั่งเปิดปิดแปรงจาก Web UI (BRUSH:0 หรือ BRUSH:1)
    else if (camResponse.startsWith("BRUSH:")) {
      String payload = camResponse.substring(6);
      brushState = (payload.toInt() == 1);
      digitalWrite(PIN_BRUSH_RELAY, brushState ? HIGH : LOW);
      Serial.println(brushState ? "Roller Brush (via Web UI): ON" : "Roller Brush (via Web UI): OFF");
    }
    // ข้อความแจ้งสถานะอื่นๆ จากกล้อง
    else {
      Serial.println("[ESP32-CAM]: " + camResponse);
    }
  }
  
  // เล่นเมโลดี้เตือนเมื่อระบบกำลังทำงานปัดกวาด (Non-blocking)
  playMelodyNonBlocking();
  
  delay(10);
}

void printRoomStatus() {
  Serial.print("Current Room selected: ");
  Serial.println(roomNumber);
}
