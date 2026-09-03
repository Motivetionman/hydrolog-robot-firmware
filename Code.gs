// ==========================================
// การตั้งค่า (Configuration)
// ==========================================
// 1. ใส่ ID ของโฟลเดอร์ Google Drive ที่ต้องการเก็บรูป (ได้จาก URL ของโฟลเดอร์)
var FOLDER_ID = "ใส่_ID_โฟลเดอร์ที่นี่"; 

// 2. ใส่ ID ของ Google Sheet (ได้จาก URL ของ Sheet)
var SHEET_ID = "ใส่_ID_Sheetที่นี่"; 

// 3. ชื่อของ Sheet Tab (ค่าเริ่มต้นมักจะเป็น "Sheet1" หรือ "แผ่นที่ 1")
var SHEET_NAME = "Sheet1";

// 4. ใส่ LINE Channel Access Token สำหรับ Line Bot
var LINE_ACCESS_TOKEN = "ใส่_CHANNEL_ACCESS_TOKEN_ที่นี่";

// 5. LINE User ID ของเจ้าของห้องทดสอบ (ถ้าไม่พบ ID ในฐานข้อมูล จะส่งมาที่นี่แทน)
var DEFAULT_TEST_LINE_USER_ID = "ใส่_LINE_USER_ID_ทดสอบที่นี่";

// 6. LINE User ID ของเจ้าของหอ (สำหรับแจ้งเตือนค่าน้ำสูงผิดปกติ)
var DORM_OWNER_LINE_USER_ID = "ใส่_LINE_USER_ID_เจ้าของหอที่นี่";

// 7. เกณฑ์ค่าน้ำสูงผิดปกติ (หน่วย: ลูกบาศก์เมตร - ลบ.ม.)
var ABNORMAL_WATER_THRESHOLD = 15.0;

// ==========================================
// 🚀 Main Webhook: doPost
// ==========================================
function doPost(e) {
  try {
    var rawContents = e.postData.contents;
    var data = JSON.parse(rawContents);
    
    // แยกแยะว่าเป็น Webhook จาก LINE หรือข้อมูลจาก ESP32-CAM
    if (data.events && data.events.length > 0) {
      return handleLineWebhook(data);
    } else {
      return handleEsp32CamUpload(data);
    }
  } catch (error) {
    console.error("เกิดข้อผิดพลาดในการทำงาน: " + error.toString());
    var errorResponse = {
      "status": "error", 
      "message": error.toString()
    };
    return ContentService.createTextOutput(JSON.stringify(errorResponse)).setMimeType(ContentService.MimeType.JSON);
  }
}

// ==========================================
// 📷 จัดการรูปภาพที่ส่งมาจาก ESP32-CAM
// ==========================================
function handleEsp32CamUpload(data) {
  var base64Data = data.image_base64;
  var roomNumber = data.room_number || "Unknown";
  var meterType = data.meter_type; // 'water' หรือ 'electricity'
  
  if (!base64Data || !meterType) {
    throw new Error("ข้อมูลไม่ครบถ้วน (ขาด image_base64 หรือ meter_type)");
  }
  
  // 1. แปลง Base64 เป็นรูปภาพ
  var decodedImage = Utilities.base64Decode(base64Data);
  var filename = roomNumber + "_" + meterType + "_" + Utilities.formatDate(new Date(), "GMT+7", "yyyyMMdd_HHmmss") + ".jpg";
  var blob = Utilities.newBlob(decodedImage, MimeType.JPEG, filename);
  
  // 2. บันทึกรูปใน Google Drive
  var folder = DriveApp.getFolderById(FOLDER_ID);
  var file = folder.createFile(blob);
  
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (shareError) {
    console.warn("ไม่สามารถแชร์ภาพสาธารณะได้: " + shareError.toString());
  }
  
  var imageUrl = file.getUrl();
  var timestamp = Utilities.formatDate(new Date(), "GMT+7", "dd/MM/yyyy HH:mm:ss");
  
  // 3. จำลองการอ่านค่า OCR (Mock OCR สำหรับเทอมนี้)
  var lastConfirmedValue = getLastConfirmedReading(roomNumber, meterType);
  var currentReadingValue = getMockOcrReading(roomNumber, meterType, lastConfirmedValue);
  
  // 4. คำนวณปริมาณการใช้งานเพื่อเช็กความผิดปกติ (สำหรับน้ำ)
  if (meterType === "water") {
    var consumption = currentReadingValue - lastConfirmedValue;
    if (consumption >= ABNORMAL_WATER_THRESHOLD) {
      // ค่าน้ำสูงผิดปกติ -> แจ้งเตือนเจ้าของหอ
      notifyDormOwnerAbnormalWater(roomNumber, currentReadingValue, lastConfirmedValue, consumption, imageUrl);
    }
  }
  
  // 5. บันทึกข้อมูลลง Google Sheet
  // คอลัมน์: Timestamp | Room Number | Water Meter URL | Electricity Meter URL | Water Value | Elec Value | Water Status | Elec Status | Last Updated
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
  if (!sheet) {
    throw new Error("หาแผ่นงานชื่อ '" + SHEET_NAME + "' ไม่พบ");
  }
  
  var rowData = [
    timestamp,
    roomNumber,
    (meterType === "water") ? imageUrl : "",
    (meterType === "electricity") ? imageUrl : "",
    (meterType === "water") ? currentReadingValue : "",
    (meterType === "electricity") ? currentReadingValue : "",
    (meterType === "water") ? "Pending" : "",
    (meterType === "electricity") ? "Pending" : "",
    timestamp
  ];
  
  sheet.appendRow(rowData);
  var newRowIndex = sheet.getLastRow();
  
  // 6. ส่ง LINE Flex Message ไปให้เจ้าของห้องคอนเฟิร์มรูปภาพมิเตอร์
  sendLineVerification(roomNumber, meterType, imageUrl, currentReadingValue, newRowIndex);
  
  var response = {
    "status": "success", 
    "fileUrl": imageUrl,
    "reading_value": currentReadingValue,
    "message": "Data logged, OCR mocked, and Line confirmation sent for room " + roomNumber
  };
  return ContentService.createTextOutput(JSON.stringify(response)).setMimeType(ContentService.MimeType.JSON);
}

// ==========================================
// 🤖 ฟังก์ชันคัดลอกค่า/จำลอง OCR (Mock OCR Engine)
// ==========================================
function getMockOcrReading(roomNumber, meterType, lastReading) {
  // จำลองว่ามิเตอร์มีหน่วยขยับขึ้นทีละ 1-5 หน่วย
  var increment = Math.floor(Math.random() * 5) + 1; 
  return lastReading + increment;
}

// ค้นหาค่าล่าสุดที่ได้รับการกดยืนยันแล้วในห้องนั้นๆ
function getLastConfirmedReading(roomNumber, meterType) {
  try {
    var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
    if (!sheet) return 0;
    var data = sheet.getDataRange().getValues();
    
    // คอลัมน์ (0-indexed):
    // 1 = Room Number, 4 = Water Value, 5 = Elec Value, 6 = Water Status, 7 = Elec Status
    var valCol = (meterType === "water") ? 4 : 5;
    var statusCol = (meterType === "water") ? 6 : 7;
    
    // วนสแกนย้อนหลังขึ้นไปหาแถวบนสุด
    for (var i = data.length - 1; i >= 1; i--) {
      if (data[i][1].toString() === roomNumber.toString()) {
        var status = data[i][statusCol];
        if (status === "Confirmed" || status === "Auto-Confirmed") {
          var val = parseFloat(data[i][valCol]);
          if (!isNaN(val)) return val;
        }
      }
    }
  } catch (e) {
    console.warn("ไม่สามารถหาค่าประวัติล่าสุดได้: " + e.toString());
  }
  return 100; // ค่าเริ่มต้นถ้าไม่มีประวัติมาก่อนเลย
}

// ==========================================
// 💬 ดึงข้อมูลติดต่อ Line User ID จากหมายเลขห้อง
// ==========================================
function getLineUserIdForRoom(roomNumber) {
  try {
    // แนะนำสร้างแผ่นงานชื่อ "Rooms" มีโครงสร้าง: คอลัมน์ A (Room Number) | คอลัมน์ B (LINE User ID)
    var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName("Rooms");
    if (!sheet) return null;
    
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (data[i][0].toString() === roomNumber.toString()) {
        return data[i][1]; 
      }
    }
  } catch (e) {
    console.warn("ดึงข้อมูลห้องจากชีต 'Rooms' ไม่สำเร็จ: " + e.toString());
  }
  return null;
}

// ==========================================
// 📨 ส่งข้อความ Flex Message ไปหาเจ้าของห้อง
// ==========================================
function sendLineVerification(roomNumber, meterType, imageUrl, readingValue, rowId) {
  var toUserId = getLineUserIdForRoom(roomNumber) || DEFAULT_TEST_LINE_USER_ID;
  if (!toUserId || toUserId === "ใส่_LINE_USER_ID_ทดสอบที่นี่") {
    console.warn("ไม่ส่ง LINE: ขาดรหัส LINE User ID สำหรับห้อง " + roomNumber);
    return;
  }
  
  var url = "https://api.line.me/v2/bot/message/push";
  
  // Flex Message JSON แบบกระชับและรองรับการโต้ตอบด้วยปุ่มกดยืนยันค่าน้ำ/ค่าไฟ
  var flexContents = {
    "type": "bubble",
    "hero": {
      "type": "image",
      "url": imageUrl,
      "size": "full",
      "aspectRatio": "4:3",
      "aspectMode": "cover"
    },
    "body": {
      "type": "box",
      "layout": "vertical",
      "contents": [
        {
          "type": "text",
          "text": "ยืนยันผลการจดมิเตอร์ 🤖",
          "weight": "bold",
          "size": "lg"
        },
        {
          "type": "box",
          "layout": "vertical",
          "margin": "md",
          "spacing": "xs",
          "contents": [
            {
              "type": "box",
              "layout": "baseline",
              "spacing": "sm",
              "contents": [
                { "type": "text", "text": "ห้อง", "color": "#aaaaaa", "size": "sm", "flex": 2 },
                { "type": "text", "text": roomNumber.toString(), "wrap": true, "color": "#666666", "size": "sm", "flex": 5 }
              ]
            },
            {
              "type": "box",
              "layout": "baseline",
              "spacing": "sm",
              "contents": [
                { "type": "text", "text": "ประเภท", "color": "#aaaaaa", "size": "sm", "flex": 2 },
                { "type": "text", "text": (meterType === "water") ? "มิเตอร์น้ำ" : "มิเตอร์ไฟ", "wrap": true, "color": "#666666", "size": "sm", "flex": 5 }
              ]
            },
            {
              "type": "box",
              "layout": "baseline",
              "spacing": "sm",
              "contents": [
                { "type": "text", "text": "ค่าที่อ่านได้", "color": "#aaaaaa", "size": "sm", "flex": 2 },
                { 
                  "type": "text", 
                  "text": readingValue + ((meterType === "water") ? " ลบ.ม. (m³)" : " หน่วย (kWh)"), 
                  "wrap": true, 
                  "color": "#333333", 
                  "weight": "bold", 
                  "size": "sm", 
                  "flex": 5 
                }
              ]
            }
          ]
        }
      ]
    },
    "footer": {
      "type": "box",
      "layout": "vertical",
      "spacing": "sm",
      "contents": [
        {
          "type": "button",
          "style": "primary",
          "color": "#06b6d4",
          "height": "sm",
          "action": {
            "type": "postback",
            "label": "✅ ถูกต้อง (Confirm)",
            "data": "action=confirm&row=" + rowId + "&type=" + meterType + "&room=" + roomNumber
          }
        },
        {
          "type": "button",
          "style": "secondary",
          "height": "sm",
          "action": {
            "type": "postback",
            "label": "❌ ไม่ถูกต้อง (Flag Issue)",
            "data": "action=reject&row=" + rowId + "&type=" + meterType + "&room=" + roomNumber
          }
        }
      ]
    }
  };
  
  var payload = {
    "to": toUserId,
    "messages": [
      {
        "type": "flex",
        "altText": "ตรวจมิเตอร์ห้อง " + roomNumber,
        "contents": flexContents
      }
    ]
  };
  
  var options = {
    "method": "post",
    "headers": {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + LINE_ACCESS_TOKEN
    },
    "payload": JSON.stringify(payload),
    "muteHttpExceptions": true
  };
  
  var response = UrlFetchApp.fetch(url, options);
  console.log("LINE Verification Sent: " + response.getContentText());
}

// ==========================================
// 🤖 จัดการ Webhook ของ LINE Bot (การกดปุ่ม)
// ==========================================
function handleLineWebhook(payload) {
  for (var i = 0; i < payload.events.length; i++) {
    var event = payload.events[i];
    
    // ตรวจหาเหตุการณ์ที่ส่งมาจากการกดยืนยันปุ่ม Flex Message (Postback)
    if (event.type === "postback") {
      var dataStr = event.postback.data;
      var params = parseQueryString(dataStr);
      
      var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
      var row = parseInt(params.row);
      var meterType = params.type;
      
      var status = (params.action === "confirm") ? "Confirmed" : "Rejected";
      var replyToken = event.replyToken;
      
      if (sheet && row <= sheet.getLastRow()) {
        // คอลัมน์สถานะ (7 = Water Status, 8 = Elec Status)
        var statusCol = (meterType === "water") ? 7 : 8;
        sheet.getRange(row, statusCol).setValue(status);
        sheet.getRange(row, 9).setValue(Utilities.formatDate(new Date(), "GMT+7", "dd/MM/yyyy HH:mm:ss"));
        
        var replyText = "บันทึกผลการตรวจสอบของห้องคุณเรียบร้อยแล้ว:\n" + 
                        ((params.action === "confirm") ? "✅ ข้อมูลถูกต้องและบันทึกเข้าระบบแล้ว" : "❌ แจ้งข้อมูลผิดพลาด เจ้าหน้าที่จะลงพื้นที่ตรวจสอบอีกครั้งค่ะ");
        sendLineReply(replyToken, replyText);
      }
    }
  }
  return ContentService.createTextOutput(JSON.stringify({"status": "ok"})).setMimeType(ContentService.MimeType.JSON);
}

function parseQueryString(str) {
  var obj = {};
  var pairs = str.split('&');
  for (var i = 0; i < pairs.length; i++) {
    var pair = pairs[i].split('=');
    obj[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1]);
  }
  return obj;
}

function sendLineReply(replyToken, text) {
  var url = "https://api.line.me/v2/bot/message/reply";
  var payload = {
    "replyToken": replyToken,
    "messages": [
      { "type": "text", "text": text }
    ]
  };
  var options = {
    "method": "post",
    "headers": {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + LINE_ACCESS_TOKEN
    },
    "payload": JSON.stringify(payload),
    "muteHttpExceptions": true
  };
  UrlFetchApp.fetch(url, options);
}

// ==========================================
// ⚠️ แจ้งเตือนเจ้าของหอเมื่อพบค่าน้ำสูงผิดปกติ
// ==========================================
function notifyDormOwnerAbnormalWater(roomNumber, currentReading, previousReading, consumption, imageUrl) {
  if (!DORM_OWNER_LINE_USER_ID || DORM_OWNER_LINE_USER_ID === "ใส่_LINE_USER_ID_เจ้าของหอที่นี่") {
    console.warn("ไม่สามารถส่งแจ้งเตือนได้: ขาด LINE User ID ของเจ้าของหอ");
    return;
  }
  
  var url = "https://api.line.me/v2/bot/message/push";
  var textMsg = "⚠️ [แจ้งเตือนด่วน!] พบค่าน้ำสูงผิดปกติ\n" +
                "ห้อง: " + roomNumber + "\n" +
                "ค่าจดปัจจุบัน: " + currentReading + " ลบ.ม.\n" +
                "ค่าจดครั้งก่อน: " + previousReading + " ลบ.ม.\n" +
                "ปริมาณการใช้น้ำรอบนี้: " + consumption.toFixed(2) + " ลบ.ม. (เกินค่ามาตรฐาน " + ABNORMAL_WATER_THRESHOLD + " ลบ.ม.)\n" +
                "ลิงก์ตรวจสอบรูปถ่ายมิเตอร์: " + imageUrl;
                
  var payload = {
    "to": DORM_OWNER_LINE_USER_ID,
    "messages": [
      { "type": "text", "text": textMsg }
    ]
  };
  
  var options = {
    "method": "post",
    "headers": {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + LINE_ACCESS_TOKEN
    },
    "payload": JSON.stringify(payload),
    "muteHttpExceptions": true
  };
  UrlFetchApp.fetch(url, options);
}

// ==========================================
// ⏰ ฟังก์ชันยืนยันอัตโนมัติ 7 วัน (Auto-Confirm)
// (สร้าง Time-Driven Trigger ใน Apps Script ให้รันวันละครั้ง)
// ==========================================
function autoConfirmOldReadings() {
  try {
    var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
    if (!sheet) return;
    
    var data = sheet.getDataRange().getValues();
    var now = new Date();
    var sevenDaysAgo = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
    
    // เริ่มสแกนจากแถวที่ 2 (ข้ามส่วนหัว)
    for (var i = 1; i < data.length; i++) {
      var timestampStr = data[i][0]; // คอลัมน์ 1
      var timestamp = new Date(timestampStr);
      
      if (!isNaN(timestamp.getTime()) && timestamp < sevenDaysAgo) {
        var updated = false;
        
        // คอลัมน์ 7 (Water Status) และ คอลัมน์ 8 (Elec Status) 
        // อัปเดตเฉพาะแถวที่มีลิงก์ภาพ และยังมีสถานะเป็น "Pending"
        if (data[i][2] && data[i][6] === "Pending") {
          sheet.getRange(i + 1, 7).setValue("Auto-Confirmed");
          updated = true;
        }
        if (data[i][3] && data[i][7] === "Pending") {
          sheet.getRange(i + 1, 8).setValue("Auto-Confirmed");
          updated = true;
        }
        
        if (updated) {
          sheet.getRange(i + 1, 9).setValue(Utilities.formatDate(now, "GMT+7", "dd/MM/yyyy HH:mm:ss"));
        }
      }
    }
    console.log("สแกนและ Auto-confirm รายการค้างเกิน 7 วันเรียบร้อยแล้ว");
  } catch (e) {
    console.error("เกิดข้อผิดพลาดในการ Auto-Confirm: " + e.toString());
  }
}

// ==========================================
// 🌐 ฟังก์ชันตอบกลับ GET Request (สำหรับทดสอบหน้าเว็บ)
// ==========================================
function doGet(e) {
  return ContentService.createTextOutput("HydroLog API Webhook is running active!");
}
