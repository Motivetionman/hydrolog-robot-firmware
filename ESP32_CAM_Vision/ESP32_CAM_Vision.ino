#include "esp_camera.h"
#include <WiFi.h>
#include <HTTPClient.h>
#include <ESP32Servo.h>
#include "mbedtls/base64.h"
#include "esp_http_server.h"

// ==========================================
// การตั้งค่าเครือข่าย (WiFi)
// ==========================================
const char* ssid = "ใส่ชื่อ_WIFI_ของคุณ";
const char* password = "ใส่รหัสผ่าน_WIFI_ของคุณ";

// ==========================================
// การตั้งค่า Google Apps Script (Webhook)
// ==========================================
String serverName = "https://script.google.com/macros/s/AKfycbz4yv1hSqVXofPKlg7u79yEe8PrEintbyQklJpU_XhP3lrwL8yQ9yykytDI2AsUUK87/exec";

// ==========================================
// การตั้งค่า Servo
// ==========================================
Servo camServo;
const int servoPin = 12; 

// ==========================================
// การตั้งค่าขาเชื่อมต่อกล้อง (สำหรับบอร์ด AI-Thinker)
// ==========================================
#define PWDN_GPIO_NUM     32
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM      0
#define SIOD_GPIO_NUM     26
#define SIOC_GPIO_NUM     27
#define Y9_GPIO_NUM       35
#define Y8_GPIO_NUM       34
#define Y7_GPIO_NUM       39
#define Y6_GPIO_NUM       36
#define Y5_GPIO_NUM       21
#define Y4_GPIO_NUM       19
#define Y3_GPIO_NUM       18
#define Y2_GPIO_NUM        5
#define VSYNC_GPIO_NUM    25
#define HREF_GPIO_NUM     23
#define PCLK_GPIO_NUM     22

// ==========================================
// ตัวแปรควบคุมระบบ Co-pilot
// ==========================================
httpd_handle_t camera_httpd = NULL;
bool isUploading = false;
bool takePhotoTriggered = false;
String targetMeterType = "";
String currentRoomNumber = "101";

// ==========================================
// HTML สำหรับ Web UI (พลปืน Gunner)
// ==========================================
const char index_html[] PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
    <title>ESP32-CAM Live Monitor</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700&family=Roboto:wght@300;400;700&display=swap');
        body { margin: 0; padding: 0; background-color: #0d1117; color: #c9d1d9; font-family: 'Roboto', sans-serif; overflow: hidden; display: flex; flex-direction: column; height: 100vh; }
        #video-container { position: absolute; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 1; display: flex; justify-content: center; align-items: center; background: #000; }
        #video-stream { max-width: 100%; max-height: 100%; object-fit: contain; }
        .hud { position: absolute; z-index: 10; padding: 20px; box-sizing: border-box; background: rgba(13, 17, 23, 0.6); backdrop-filter: blur(10px); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 15px; }
        #top-bar { top: 20px; left: 20px; right: 20px; display: flex; justify-content: space-between; align-items: center; }
        #bottom-panel { bottom: 20px; left: 50%; transform: translateX(-50%); text-align: center; display: flex; gap: 20px; }
        h1 { margin: 0; font-family: 'Orbitron', sans-serif; font-size: 24px; color: #58a6ff; text-transform: uppercase; letter-spacing: 2px; }
        .status-badge { display: inline-flex; align-items: center; padding: 5px 12px; border-radius: 20px; font-size: 14px; font-weight: bold; background: rgba(35, 134, 54, 0.2); color: #3fb950; border: 1px solid rgba(63, 185, 80, 0.4); }
        .status-badge.disconnected { background: rgba(248, 81, 73, 0.2); color: #f85149; border: 1px solid rgba(248, 81, 73, 0.4); }
        .data-box { background: rgba(0,0,0,0.5); padding: 15px; border-radius: 10px; min-width: 120px; border: 1px solid rgba(255,255,255,0.05); }
        .data-label { font-size: 12px; text-transform: uppercase; color: #8b949e; margin-bottom: 5px; }
        .data-value { font-size: 28px; font-family: 'Orbitron', sans-serif; color: #fff; font-weight: bold; }
        #log-box { position: absolute; bottom: 120px; left: 20px; width: 300px; height: 150px; overflow-y: auto; font-family: monospace; font-size: 12px; color: #8b949e; background: rgba(0,0,0,0.7); padding: 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1); }
        .loading-overlay { display: none; position: absolute; top:0; left:0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.8); z-index: 100; justify-content: center; align-items: center; flex-direction: column; color: white; font-family: 'Orbitron', sans-serif; }
        .spinner { border: 4px solid rgba(255,255,255,0.1); width: 50px; height: 50px; border-radius: 50%; border-left-color: #58a6ff; animation: spin 1s linear infinite; margin-bottom: 20px; }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    </style>
</head>
<body>
    <div id="video-container">
        <img id="video-stream" src="/stream" crossorigin="anonymous" alt="Live Stream">
    </div>
    
    <div class="hud" id="top-bar">
        <div>
            <h1>METER-BOT VISOR</h1>
            <div style="font-size: 12px; color: #8b949e; margin-top: 5px;">Powered by ESP32-CAM</div>
        </div>
        <div id="gamepad-status" class="status-badge disconnected">
            <span class="dot"></span> Xbox Controller: Disconnected
        </div>
    </div>

    <div id="log-box"></div>

    <div class="hud" id="bottom-panel">
        <div class="data-box">
            <div class="data-label">Current Room</div>
            <div class="data-value" id="room-display">101</div>
        </div>
        <div class="data-box">
            <div class="data-label">Camera Angle</div>
            <div class="data-value" id="angle-display">90&deg;</div>
        </div>
    </div>

    <div class="loading-overlay" id="loading">
        <div class="spinner"></div>
        <h2 id="loading-text">CAPTURING HIGH-RES IMAGE...</h2>
        <p style="color: #8b949e">Uploading to Cloud. Stream paused.</p>
    </div>

    <script>
        const logBox = document.getElementById('log-box');
        const gpStatus = document.getElementById('gamepad-status');
        const roomDisp = document.getElementById('room-display');
        const angleDisp = document.getElementById('angle-display');
        const loadingOverlay = document.getElementById('loading');
        
        let roomNum = 101;
        let camAngle = 90;
        let lastTrans = 0;
        let lastRot = 0;
        let isUploading = false;
        let brushState = false;

        function log(msg) {
            const div = document.createElement('div');
            div.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
            logBox.appendChild(div);
            logBox.scrollTop = logBox.scrollHeight;
        }

        window.addEventListener("gamepadconnected", (e) => {
            gpStatus.className = 'status-badge';
            gpStatus.innerHTML = `&#127918; ${e.gamepad.id.split(' ')[0]} Connected`;
            log("Gamepad Connected: " + e.gamepad.id);
            requestAnimationFrame(updateLoop);
        });

        window.addEventListener("gamepaddisconnected", (e) => {
            gpStatus.className = 'status-badge disconnected';
            gpStatus.innerHTML = `Xbox Controller: Disconnected`;
            log("Gamepad Disconnected");
            sendCommand('drive', { y: 0, z: 0 }); // Safe stop
        });

        function sendCommand(cmd, params = {}) {
            if (isUploading) return; 
            let url = `/action?cmd=${cmd}`;
            for (let k in params) url += `&${k}=${params[k]}`;
            
            fetch(url).then(res => res.text()).then(txt => {
                if(txt !== "OK") log(`CMD ${cmd}: ${txt}`);
                if(txt === "UPLOAD_START") {
                    isUploading = true;
                    loadingOverlay.style.display = 'flex';
                    checkUploadStatus();
                }
            }).catch(e => console.error(e));
        }

        function checkUploadStatus() {
            setTimeout(() => {
                fetch('/status').then(res => res.text()).then(txt => {
                    if(txt === "IDLE") {
                        isUploading = false;
                        loadingOverlay.style.display = 'none';
                        log("Upload Complete! Stream Resumed.");
                    } else {
                        checkUploadStatus();
                    }
                }).catch(e => checkUploadStatus());
            }, 1000);
        }

        let lastBtnState = {};
        
        function updateLoop() {
            const gp = navigator.getGamepads()[0];
            if (!gp) return;

            if (!isUploading) {
                // Driving: Xbox Axis 1 (LStick Y), Axis 2 (RStick X)
                let trans = Math.round(-gp.axes[1] * 255); 
                let rot = Math.round(gp.axes[2] * 255);
                
                // Deadzones
                if(Math.abs(trans) < 30) trans = 0;
                if(Math.abs(rot) < 30) rot = 0;

                // Only send if changed by more than 10 units to save WiFi bandwidth
                if(Math.abs(trans - lastTrans) > 10 || Math.abs(rot - lastRot) > 10) {
                    sendCommand('drive', {y: trans, z: rot});
                    lastTrans = trans;
                    lastRot = rot;
                }

                // Buttons
                const pressed = (b) => gp.buttons[b].pressed;
                
                if (pressed(2) && !lastBtnState[2]) sendCommand('photo', {type: 'WATER', room: roomNum});
                if (pressed(3) && !lastBtnState[3]) sendCommand('photo', {type: 'ELEC', room: roomNum});
                
                if (pressed(5) && !lastBtnState[5]) {
                    brushState = !brushState;
                    sendCommand('brush', {state: brushState ? 1 : 0});
                    log("Brush: " + (brushState ? "ON" : "OFF"));
                }

                if (pressed(14) && !lastBtnState[14]) { if(roomNum>1) roomNum--; roomDisp.innerText = roomNum; }
                if (pressed(15) && !lastBtnState[15]) { roomNum++; roomDisp.innerText = roomNum; }
                
                if (pressed(12) && !lastBtnState[12]) { camAngle = Math.min(180, camAngle+15); angleDisp.innerHTML = camAngle+"&deg;"; sendCommand('tilt', {a: camAngle}); }
                if (pressed(13) && !lastBtnState[13]) { camAngle = Math.max(0, camAngle-15); angleDisp.innerHTML = camAngle+"&deg;"; sendCommand('tilt', {a: camAngle}); }

                for(let i=0; i<gp.buttons.length; i++) lastBtnState[i] = pressed(i);
            }
            setTimeout(() => requestAnimationFrame(updateLoop), 100); 
        }
    </script>
</body>
</html>
)rawliteral";

// ==========================================
// HTTP Handlers
// ==========================================

esp_err_t index_handler(httpd_req_t *req) {
    httpd_resp_set_type(req, "text/html");
    return httpd_resp_send(req, index_html, strlen(index_html));
}

esp_err_t status_handler(httpd_req_t *req) {
    httpd_resp_set_type(req, "text/plain");
    if(isUploading) return httpd_resp_send(req, "UPLOADING", 9);
    return httpd_resp_send(req, "IDLE", 4);
}

esp_err_t action_handler(httpd_req_t *req) {
    char buf[100];
    if (httpd_req_get_url_query_str(req, buf, sizeof(buf)) == ESP_OK) {
        char cmd[20];
        if (httpd_query_key_value(buf, "cmd", cmd, sizeof(cmd)) == ESP_OK) {
            
            if (strcmp(cmd, "drive") == 0) {
                char y_str[10], z_str[10];
                if (httpd_query_key_value(buf, "y", y_str, sizeof(y_str)) == ESP_OK &&
                    httpd_query_key_value(buf, "z", z_str, sizeof(z_str)) == ESP_OK) {
                    // ส่งคำสั่งผ่าน Serial ลงไปให้บอร์ดหลักขับมอเตอร์
                    Serial.printf("DRIVE:%s,%s\n", y_str, z_str);
                    return httpd_resp_send(req, "OK", 2);
                }
            } 
            else if (strcmp(cmd, "brush") == 0) {
                char state[10];
                if (httpd_query_key_value(buf, "state", state, sizeof(state)) == ESP_OK) {
                    Serial.printf("BRUSH:%s\n", state);
                    return httpd_resp_send(req, "OK", 2);
                }
            }
            else if (strcmp(cmd, "tilt") == 0) {
                char a_str[10];
                if (httpd_query_key_value(buf, "a", a_str, sizeof(a_str)) == ESP_OK) {
                    camServo.write(atoi(a_str));
                    return httpd_resp_send(req, "OK", 2);
                }
            }
            else if (strcmp(cmd, "photo") == 0) {
                char type[20], room[10];
                if (httpd_query_key_value(buf, "type", type, sizeof(type)) == ESP_OK &&
                    httpd_query_key_value(buf, "room", room, sizeof(room)) == ESP_OK) {
                    
                    targetMeterType = String(type);
                    currentRoomNumber = String(room);
                    takePhotoTriggered = true; // ตั้งธงให้ loop() ดึงไปถ่ายรูป
                    
                    return httpd_resp_send(req, "UPLOAD_START", 12);
                }
            }
        }
    }
    return httpd_resp_send(req, "ERR", 3);
}

#define PART_BOUNDARY "123456789000000000000987654321"
static const char* _STREAM_CONTENT_TYPE = "multipart/x-mixed-replace;boundary=" PART_BOUNDARY;
static const char* _STREAM_BOUNDARY = "\r\n--" PART_BOUNDARY "\r\n";
static const char* _STREAM_PART = "Content-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n";

esp_err_t stream_handler(httpd_req_t *req) {
    camera_fb_t * fb = NULL;
    esp_err_t res = ESP_OK;
    char * part_buf[64];

    res = httpd_resp_set_type(req, _STREAM_CONTENT_TYPE);
    if(res != ESP_OK) return res;

    while (true) {
        if (isUploading || takePhotoTriggered) {
            // ช่วงที่กำลังอัปโหลด ให้หยุดสตรีมชั่วคราวเพื่อประหยัด RAM (แต่ไม่หลุดการเชื่อมต่อ)
            delay(500);
            continue;
        }

        fb = esp_camera_fb_get();
        if (!fb) {
            Serial.println("Camera capture failed");
            res = ESP_FAIL;
        } else {
            size_t hlen = snprintf((char *)part_buf, 64, _STREAM_PART, fb->len);
            res = httpd_resp_send_chunk(req, (const char *)part_buf, hlen);
            if(res == ESP_OK){
                res = httpd_resp_send_chunk(req, (const char *)fb->buf, fb->len);
            }
            if(res == ESP_OK){
                res = httpd_resp_send_chunk(req, _STREAM_BOUNDARY, strlen(_STREAM_BOUNDARY));
            }
            esp_camera_fb_return(fb);
        }
        if(res != ESP_OK) break; // Client disconnected
    }
    return res;
}

void startCameraServer() {
    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.server_port = 80;

    httpd_uri_t index_uri = { .uri = "/", .method = HTTP_GET, .handler = index_handler, .user_ctx = NULL };
    httpd_uri_t stream_uri = { .uri = "/stream", .method = HTTP_GET, .handler = stream_handler, .user_ctx = NULL };
    httpd_uri_t action_uri = { .uri = "/action", .method = HTTP_GET, .handler = action_handler, .user_ctx = NULL };
    httpd_uri_t status_uri = { .uri = "/status", .method = HTTP_GET, .handler = status_handler, .user_ctx = NULL };

    if (httpd_start(&camera_httpd, &config) == ESP_OK) {
        httpd_register_uri_handler(camera_httpd, &index_uri);
        httpd_register_uri_handler(camera_httpd, &stream_uri);
        httpd_register_uri_handler(camera_httpd, &action_uri);
        httpd_register_uri_handler(camera_httpd, &status_uri);
    }
}

// ==========================================
// Setup & Loop
// ==========================================

void setup() {
  Serial.begin(115200);
  
  camServo.setPeriodHertz(50);
  camServo.attach(servoPin, 500, 2400);
  camServo.write(90);
  
  WiFi.begin(ssid, password);
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi connected. IP: ");
  Serial.println(WiFi.localIP());

  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
  config.pin_sscb_sda = SIOD_GPIO_NUM;
  config.pin_sscb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG; 
  
  // ตั้งเป็น VGA สำหรับให้สตรีมภาพได้ลื่นไหล ไม่กระตุก
  if(psramFound()){
    config.frame_size = FRAMESIZE_VGA; 
    config.jpeg_quality = 12;
    config.fb_count = 2;
  } else {
    config.frame_size = FRAMESIZE_VGA; 
    config.jpeg_quality = 12;
    config.fb_count = 1;
  }

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("Camera init failed with error 0x%x\n", err);
    return;
  }

  startCameraServer();
  Serial.println("Web Server & Camera Ready!");
}

void loop() {
  // รับคำสั่งจากบอร์ดหลักทาง Serial (จอย PS4)
  if (Serial.available() > 0) {
    String command = Serial.readStringUntil('\n');
    command.trim();
    
    if (command.startsWith("WATER:")) {
      currentRoomNumber = command.substring(6);
      targetMeterType = "WATER";
      takePhotoTriggered = true;
    } 
    else if (command.startsWith("ELEC:")) {
      currentRoomNumber = command.substring(5);
      targetMeterType = "ELEC";
      takePhotoTriggered = true;
    }
  }

  // เข้าสู่โหมดถ่ายภาพ 3MP ถ้ามีการสั่งผ่านจอย PS4 หรือ Web UI
  if (takePhotoTriggered) {
    isUploading = true;
    delay(500); // รอให้ระบบ Stream สไลด์เข้าสู่สถานะหลับ (Paused) เพื่อป้องกัน RAM ชนกัน
    
    takeAndSendPhoto(targetMeterType, currentRoomNumber);
    
    takePhotoTriggered = false;
    isUploading = false;
  }
}

void takeAndSendPhoto(String meterType, String roomNumberStr) {
  sensor_t * s = esp_camera_sensor_get();
  
  // 1. ปรับสลับความละเอียดเป็นสูงสุด 3MP (QXGA)
  Serial.println("Switching to 3MP (QXGA) Mode...");
  s->set_framesize(s, FRAMESIZE_QXGA);
  delay(1000); // รอ Auto-Exposure ปรับแสงให้เข้าที่ 1 วินาที
  
  // 2. ถ่ายภาพ
  camera_fb_t * fb = esp_camera_fb_get();  
  if(!fb) {
    Serial.println("High-res capture failed");
    s->set_framesize(s, FRAMESIZE_VGA); 
    return;
  }
  Serial.println("Photo captured. Size: " + String(fb->len) + " bytes");
  
  // 3. แปลงภาพเป็น Base64
  size_t output_len;
  mbedtls_base64_encode(NULL, 0, &output_len, fb->buf, fb->len);
  unsigned char * base64_buf = (unsigned char *) malloc(output_len);
  
  if (base64_buf == NULL) {
    Serial.println("Base64 memory allocation failed");
    esp_camera_fb_return(fb);
    s->set_framesize(s, FRAMESIZE_VGA); 
    return;
  }
  
  mbedtls_base64_encode(base64_buf, output_len, &output_len, fb->buf, fb->len);
  String base64String = String((char *)base64_buf);
  free(base64_buf);
  esp_camera_fb_return(fb); 
  
  // 4. ส่งข้อมูลขึ้น Google Apps Script
  String jsonPayload = "{";
  jsonPayload += "\"room_number\":\"" + roomNumberStr + "\",";
  jsonPayload += "\"meter_type\":\"" + meterType + "\",";
  jsonPayload += "\"image_base64\":\"" + base64String + "\"";
  jsonPayload += "}";
  base64String = ""; // Clear RAM
  
  if(WiFi.status() == WL_CONNECTED){
    HTTPClient http;
    http.begin(serverName);
    http.addHeader("Content-Type", "application/json");
    Serial.println("Uploading to Google Drive...");
    int code = http.POST(jsonPayload);
    if(code > 0){
      Serial.println("Upload Success! Code: " + String(code));
    } else {
      Serial.println("Upload Failed! Code: " + String(code));
    }
    http.end();
  }
  
  // 5. ปรับความละเอียดกลับไปเป็นโหมดสตรีม (VGA)
  Serial.println("Returning to Stream (VGA) Mode...");
  s->set_framesize(s, FRAMESIZE_VGA);
}
