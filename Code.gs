// ==========================================
// การตั้งค่า (Configuration)
// ==========================================
// 1. ใส่ ID ของโฟลเดอร์ Google Drive ที่ต้องการเก็บรูป (ได้จาก URL ของโฟลเดอร์)
var FOLDER_ID = "1Cr525NBTt4yGT0YqnnKg0CZBZY78EeYk"; 

// 2. ใส่ ID ของ Google Sheet (ได้จาก URL ของ Sheet)
var SHEET_ID = "1gO1KXYOAoP3Djr72RI72SiqziNLS1hteGyZWsFezzNE"; 

// 3. ชื่อของ Sheet Tab สำหรับเก็บ Log รูปถ่ายมิเตอร์ (ค่าเริ่มต้นมักจะเป็น "Sheet1" หรือ "แผ่นที่ 1")
var SHEET_NAME = "Sheet1";

// 3.1 ชื่อของ Sheet Tab สำหรับเก็บข้อมูลการลงทะเบียนผู้เช่า (แยกจากรูปถ่ายมิเตอร์)
var TENANT_SHEET_NAME = "Tenants";

// 4. ใส่ LINE Channel Access Token สำหรับ Line Bot
var LINE_ACCESS_TOKEN = "ZsneGgjKLmJyZraQ3OCqpmK0cIi11eoJqtVd9mdVTFLquI2KOWY2La0lr7bIYojJNrh5DmIG9J5BX7gVW/pOfDE6xM1Dlm+O30PlMldLlbf+aLX8GUrloO98Mrdld2G1z5wmjSDfQdlpvr/TfDZm6QdB04t89/1O/w1cDnyilFU=";

// 5. ค่าเริ่มต้นสำหรับการทดสอบ (LINE User ID ของผู้ดูแลระบบ)
var DEFAULT_TEST_LINE_USER_ID = "U679832d3cd45fef3d0d12221b58cc501";

// 6. ข้อมูลเชื่อมต่อ Supabase สำหรับ Two-Way Sync กับ HydroLog Web App Console
var SUPABASE_URL = "https://zeuycfrkbhlylgshqvax.supabase.co";
var SUPABASE_ANON_KEY = "sb_publishable_8yYPWktHjwes-rbbHjySwA_QUufmkE7";

// ==========================================
// 🚪 ฟังก์ชันหลัก doPost (รองรับ Raspberry Pi 5 Edge AI, Botnoi Chatbot, Web Console และ LINE Webhook)
// ==========================================
function doPost(e) {
  try {
    var data = {};
    
    // 1. ดึงข้อมูลจาก Query Parameters (เผื่อ Botnoi ส่งผ่าน URL)
    if (e && e.parameter) {
      for (var k in e.parameter) {
        data[k] = e.parameter[k];
      }
    }
    
    // 2. ดึงข้อมูลจาก Request Body (JSON หรือ Form-data)
    if (e && e.postData && e.postData.contents) {
      try {
        var parsed = JSON.parse(e.postData.contents);
        if (parsed && typeof parsed === "object") {
          for (var pk in parsed) {
            data[pk] = parsed[pk];
          }
        }
      } catch (jsonErr) {
        // หากไม่ใช่ JSON (เช่น ส่งแบบ urlencoded 'key=val&...') ข้อมูลจะถูกผูกใน e.parameter อยู่แล้ว
      }
    }
    
    // ----------------------------------------------------
    // กรณีที่ 0: มาจาก HydroLog Web Console หรือ Botnoi AI Chatbot API
    // ----------------------------------------------------
    var rawAction = (data.action || data.Action || data.intent || data.Intent || "").toString().trim();
    if (rawAction !== "") {
      data.action = rawAction;
      var lowerAct = rawAction.toLowerCase();
      if (lowerAct.indexOf("botnoi_") === 0 || 
          lowerAct.indexOf("register") !== -1 || 
          lowerAct.indexOf("bill") !== -1 || 
          lowerAct.indexOf("meter") !== -1 || 
          lowerAct.indexOf("dispute") !== -1 || 
          lowerAct.indexOf("issue") !== -1 || 
          lowerAct.indexOf("tenant") !== -1) {
        return handleBotnoiAction(data);
      }
      return handleWebConsoleAction(data);
    }
    
    // ----------------------------------------------------
    // กรณีที่ 1: มาจาก LINE Webhook (ผู้เช่าแอดไลน์ / พิมพ์ลงทะเบียนเลขห้อง)
    // ----------------------------------------------------
    if (data.events && Array.isArray(data.events)) {
      // ดักเคสปุ่ม Verify ของ LINE Console (events: []) ให้ตอบกลับทันที ป้องกัน Timeout
      if (data.events.length === 0) {
        return ContentService.createTextOutput(JSON.stringify({status: "ok"})).setMimeType(ContentService.MimeType.JSON);
      }
      return handleLineWebhook(data.events);
    }
    
    // ----------------------------------------------------
    // กรณีที่ 2: มาจาก Raspberry Pi 5 Edge AI Compute Node (อัปโหลดรูปภาพมิเตอร์ & ผล OCR)
    // ----------------------------------------------------
    var base64Data = data.image_base64;
    var roomNumber = data.room_number || "Unknown";
    var rawMeterType = (data.meter_type || "").toString().toLowerCase().trim();
    var isWater = (rawMeterType === "water" || rawMeterType === "wat");
    var isElec = (rawMeterType === "electricity" || rawMeterType === "elec");
    var meterType = isWater ? "water" : (isElec ? "electricity" : (rawMeterType || "water"));
    
    if (!base64Data) {
      return ContentService.createTextOutput(JSON.stringify({
        status: "error",
        message: "Missing 'action' or 'image_base64' in payload. Received keys: " + Object.keys(data).join(", ")
      })).setMimeType(ContentService.MimeType.JSON);
    }
    
    var decodedImage = Utilities.base64Decode(base64Data);
    var filename = roomNumber + "_" + meterType + "_" + Utilities.formatDate(new Date(), "GMT+7", "yyyyMMdd_HHmmss") + ".jpg";
    var blob = Utilities.newBlob(decodedImage, MimeType.JPEG, filename);
    
    var folder = DriveApp.getFolderById(FOLDER_ID);
    var file = folder.createFile(blob);
    
    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (shareError) {
      console.warn("ไม่สามารถแชร์ภาพสาธารณะได้: " + shareError.toString());
    }
    
    var imageUrl = file.getUrl();
    var timestamp = Utilities.formatDate(new Date(), "GMT+7", "dd/MM/yyyy HH:mm:ss");
    
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) {
      sheet = ss.getSheetByName("Rooms") || ss.getSheets()[0];
    }
    
    var waterUrl = isWater ? imageUrl : "";
    var elecUrl = isElec ? imageUrl : "";
    
    sheet.appendRow([timestamp, roomNumber, waterUrl, elecUrl]);
    
    // ส่ง LINE หาผู้เช่าห้องนั้นๆ โดยตรง
    sendLineMessage(roomNumber, meterType, imageUrl);
    
    var response = {
      "status": "success", 
      "fileUrl": imageUrl,
      "message": "Data logged and sent to tenant LINE for room " + roomNumber
    };
    return ContentService.createTextOutput(JSON.stringify(response)).setMimeType(ContentService.MimeType.JSON);
    
  } catch (error) {
    console.error("เกิดข้อผิดพลาดในการทำงาน: " + error.toString());
    var errorResponse = {
      "status": "error", 
      "message": error.toString()
    };
    return ContentService.createTextOutput(JSON.stringify(errorResponse)).setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  // รองรับการเรียกจาก Web Console หรือ Botnoi ผ่าน GET Query Parameters (สำรองกรณี Network ติดขัด)
  var action = (e && e.parameter && (e.parameter.action || e.parameter.Action)) ? (e.parameter.action || e.parameter.Action).toString().trim() : "";
  if (action !== "") {
    e.parameter.action = action;
    if (action.toLowerCase().indexOf("botnoi_") === 0) {
      return handleBotnoiAction(e.parameter);
    }
    return handleWebConsoleAction(e.parameter);
  }
  return ContentService.createTextOutput("🚀 HydroLog Meter Logging, Botnoi AI & LINE Bot API is running perfectly!");
}

// ==========================================
// 💬 จัดการ LINE Webhook Events (รองรับ Direct Standalone Mode + Dual Engine)
// ==========================================
function handleLineWebhook(events) {
  for (var i = 0; i < events.length; i++) {
    var event = events[i];
    var replyToken = event.replyToken;
    var userId = event.source ? event.source.userId : null;
    
    // 1. เมื่อมีคนเพิ่มเพื่อน (Follow)
    if (event.type === "follow") {
      var welcomeText = "💧 ยินดีต้อนรับสู่ HydroLog (น้องไฮโดรจัง)!\n" +
                        "AI ผู้ช่วยดูแลหอพักและจดมิเตอร์น้ำ-ไฟอัจฉริยะ 🤖✨\n\n" +
                        "📌 คุณพี่สามารถเริ่มต้นด้วยการลงทะเบียนห้องพัก เช่น พิมพ์:\n" +
                        "👉 ลงทะเบียน 302\n" +
                        "(รองรับห้อง 101 ถึง 510 ค่ะ 🏢)";
      replyLineTextMessageWithQuickReply(replyToken, welcomeText);
    }
    // 2. เมื่อผู้เช่าพิมพ์ข้อความในแชท
    else if (event.type === "message" && event.message.type === "text") {
      var userText = event.message.text.trim();
      var lower = userText.toLowerCase();
      
      // ดักจับคำสั่งขอดู User ID
      if (lower === "id" && userId) {
        replyLineMessage(replyToken, "🔑 LINE User ID ของคุณคือ:\n" + userId);
      }
      // ดักจับคำสั่ง เช็กค่าน้ำ / ดูบิล / มิเตอร์
      else if (lower.indexOf("บิล") !== -1 || lower.indexOf("ค่าน้ำ") !== -1 || lower.indexOf("มิเตอร์") !== -1 || lower.indexOf("เช็ก") !== -1) {
        var roomMatch = userText.match(/([1-5](?:0[1-9]|10))/);
        var targetRoom = roomMatch ? roomMatch[1] : null;
        if (!targetRoom && userId) {
          var tenant = getRoomForLineUserId(userId);
          if (tenant) targetRoom = tenant.room;
        }

        if (!targetRoom) {
          replyLineTextMessageWithQuickReply(replyToken, "ℹ️ คุณยังไม่ได้ลงทะเบียนห้องพักเลยน้าา กรุณาลงทะเบียนก่อนนะคะ เช่น พิมพ์ 'ลงทะเบียน 302' 💧");
        } else {
          var latestMeter = getLatestMeterLogForRoom(targetRoom);
          if (!latestMeter) {
            replyLineTextMessageWithQuickReply(replyToken, "ℹ️ ห้อง " + targetRoom + " ยังไม่มีข้อมูลมิเตอร์ในระบบค่ะ\n\nหุ่นยนต์น้องไฮโดรจะวิ่งตรวจมิเตอร์ช่วงวันที่ 25-30 ของเดือนนี้นะคะ 🤖🧹");
          } else {
            var billFlex = buildMeterBillFlex(targetRoom, latestMeter.timestamp, latestMeter.waterUrl, latestMeter.elecUrl);
            replyLineFlexMessage(replyToken, "💧 ใบรายงานมิเตอร์ ห้อง " + targetRoom, billFlex);
          }
        }
      }
      // ดักจับคำสั่ง แจ้งปัญหา / ค่าน้ำผิด / ท่อรั่ว
      else if (lower.indexOf("แจ้ง") !== -1 || lower.indexOf("ท่อรั่ว") !== -1 || lower.indexOf("ปัญหา") !== -1 || lower.indexOf("ผิด") !== -1 || lower.indexOf("ซ่อม") !== -1) {
        var tenant = getRoomForLineUserId(userId);
        var disputeRoom = tenant ? tenant.room : "ไม่ระบุห้อง";
        var disputePhone = tenant ? tenant.phone : "";
        var issueType = (userText.indexOf("ท่อรั่ว") !== -1) ? "ท่อน้ำรั่วซึม" : "แจ้งปัญหาค่าน้ำ/มิเตอร์";
        recordTenantDispute(disputeRoom, userId, issueType, userText, disputePhone);
        var replyDispute = "✅ น้องไฮโดรบันทึกเรื่องร้องเรียนของห้อง " + disputeRoom + " ให้เรียบร้อยแล้วค่ะ! 🏢\n\n" +
                           "📌 หัวข้อ: " + issueType + "\n" +
                           "รายละเอียด: " + userText + "\n\n" +
                           "ระบบได้ส่งแจ้งเตือนด่วนไปยังพี่แอดมินเรียบร้อยแล้ว จะรีบตรวจสอบให้ทันทีค่ะ 💖";
        replyLineTextMessageWithQuickReply(replyToken, replyDispute);
      }
      // ดักจับคำสั่ง ข้อมูลห้อง
      else if (lower.indexOf("ข้อมูลห้อง") !== -1 || lower.indexOf("ห้องของฉัน") !== -1) {
        var tenant = getRoomForLineUserId(userId);
        if (tenant) {
          var passFlex = buildTenantPassFlex(tenant.room, tenant.fullName || "ผู้เช่าห้อง " + tenant.room, tenant.phone || "-");
          replyLineFlexMessage(replyToken, "ℹ️ ข้อมูลห้องพักของคุณ", passFlex);
        } else {
          replyLineTextMessageWithQuickReply(replyToken, "ℹ️ คุณยังไม่ได้ลงทะเบียนห้องพักค่ะ พิมพ์ 'ลงทะเบียน [เลขห้อง]' ได้เลยนะคะ~");
        }
      }
      // ดักจับคำสั่ง ลงทะเบียนเลขห้อง 3 หลัก (101 - 510)
      else {
        var roomMatch = userText.match(/(?:ห้อง|room|ลงทะเบียน|\D|^)([1-5](?:0[1-9]|10))(?:\D|$)/i);
        
        if (roomMatch && userId) {
          var room = roomMatch[1];
          var nameMatch = userText.match(/(?:ชื่อ|คุณ|\s)([ก-๙a-zA-Z]{2,}(?:\s[ก-๙a-zA-Z]{2,})?)/);
          var fullName = nameMatch ? nameMatch[1].trim() : "";
          if (fullName.toLowerCase() === "room" || fullName.toLowerCase() === "ห้อง") fullName = "";
          var phoneMatch = userText.match(/(0\d{8,9})/);
          var phone = phoneMatch ? phoneMatch[1] : "";

          var regResult = registerRoomTenant(room, userId, fullName, phone);
          
          if (regResult.status === "occupied") {
            var replyOccupied = "⚠️ ห้อง " + room + " มีผู้ลงทะเบียนไว้แล้วค่ะ\n\n" +
                                "• หากคุณพิมพ์เลขห้องผิด กรุณาลองพิมพ์ใหม่อีกครั้งนะคะ\n" +
                                "• หากคุณเป็นผู้เช่าใหม่ กรุณาติดต่อแอดมินหอพักเพื่ออัปเดตสิทธิ์ห้องให้ค่ะ 🏢";
            replyLineTextMessageWithQuickReply(replyToken, replyOccupied);
          }
          else if (regResult.status === "already_registered") {
            var replyAlready = "ℹ️ บัญชี LINE ของคุณผูกอยู่กับ ห้อง " + regResult.currentRoom + " อยู่แล้วค่ะ\n\n" +
                               "🏢 การย้ายห้องจะต้องดำเนินการโดยแอดมินเท่านั้น กรุณาติดต่อแอดมินหอพักเพื่อขอย้ายห้องนะคะ";
            replyLineTextMessageWithQuickReply(replyToken, replyAlready);
          }
          else {
            var passFlex = buildTenantPassFlex(room, fullName || "ผู้เช่าห้อง " + room, phone || "-");
            replyLineFlexMessage(replyToken, "✅ ผูกห้อง " + room + " สำเร็จแล้วค่ะ", passFlex);
          }
        } 
        else if (lower.indexOf("สวัสดี") !== -1 || lower.indexOf("ดีจ้า") !== -1 || lower.indexOf("ไฮโดร") !== -1 || lower.indexOf("hello") !== -1 || lower.indexOf("hi") !== -1) {
          replyLineTextMessageWithQuickReply(replyToken, "สวัสดีค่าคุณพี่~ น้องไฮโดรจังพร้อมดูแลหอพักแล้วค่ะ! 💧✨\nเลือกเมนูด้านล่างให้น้องไฮโดรช่วยได้เลยนะคะ 💖");
        } 
        else if (lower.indexOf("น่ารัก") !== -1 || lower.indexOf("สวย") !== -1 || lower.indexOf("ขอบคุณ") !== -1) {
          replyLineTextMessageWithQuickReply(replyToken, "แฮะๆ ขอบคุณค่าคุณพี่~ ชมแบบนี้น้องไฮโดรเขินแย่เลยน้าา ถึงหนูจะเป็นหุ่นยนต์จิ๋ว 2WD แต่หนูก็ตั้งใจกวาดพื้นและจดมิเตอร์สุดฝีมือเลยนะคะ! 💖🤖");
        }
        else {
          var helpText = "🤖 น้องไฮโดรจังพร้อมดูแลค่ะ!\n\n" +
                         "📌 ลงทะเบียนรับค่าน้ำ กรุณาพิมพ์เลขห้องของคุณ เช่น:\n👉 ลงทะเบียน 301\n\n" +
                         "(รองรับห้อง 101 ถึง 510 ค่ะ 💧)";
          replyLineTextMessageWithQuickReply(replyToken, helpText);
        }
      }
    }
  }
  return ContentService.createTextOutput(JSON.stringify({status: "ok"})).setMimeType(ContentService.MimeType.JSON);
}

function replyLineMessage(replyToken, text) {
  if (!replyToken) return;
  sendLineReplyRaw(replyToken, [{ "type": "text", "text": text }]);
}

function replyLineTextMessageWithQuickReply(replyToken, text) {
  if (!replyToken) return;
  sendLineReplyRaw(replyToken, [{
    "type": "text",
    "text": text,
    "quickReply": getQuickReplyMenu()
  }]);
}

function replyLineFlexMessage(replyToken, altText, flexBubble) {
  if (!replyToken) return;
  sendLineReplyRaw(replyToken, [{
    "type": "flex",
    "altText": altText,
    "contents": flexBubble,
    "quickReply": getQuickReplyMenu()
  }]);
}

function sendLineReplyRaw(replyToken, messages) {
  var url = "https://api.line.me/v2/bot/message/reply";
  var payload = { "replyToken": replyToken, "messages": messages };
  var options = {
    "method": "post",
    "headers": {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + LINE_ACCESS_TOKEN
    },
    "payload": JSON.stringify(payload),
    "muteHttpExceptions": true
  };
  var res = UrlFetchApp.fetch(url, options);
  console.log("LINE Reply Response [" + res.getResponseCode() + "]: " + res.getContentText());
}

function getQuickReplyMenu() {
  return {
    "items": [
      { "type": "action", "action": { "type": "message", "label": "💧 เช็กค่าน้ำ", "text": "เช็กค่าน้ำ" } },
      { "type": "action", "action": { "type": "message", "label": "📸 ดูรูปมิเตอร์", "text": "ดูรูปมิเตอร์" } },
      { "type": "action", "action": { "type": "message", "label": "📝 ลงทะเบียนห้อง", "text": "ลงทะเบียน" } },
      { "type": "action", "action": { "type": "message", "label": "⚠️ แจ้งปัญหาค่าน้ำ", "text": "แจ้งปัญหา" } }
    ]
  };
}

function buildMeterBillFlex(room, timestamp, waterUrl, elecUrl) {
  var displayImg = convertDriveUrlToDirect(waterUrl || elecUrl || "https://images.unsplash.com/photo-1581092160562-40aa08e78837?w=1200&q=80");
  return {
    "type": "bubble",
    "size": "mega",
    "header": {
      "type": "box",
      "layout": "vertical",
      "backgroundColor": "#0284c7",
      "paddingTop": "16px",
      "paddingBottom": "16px",
      "contents": [
        { "type": "text", "text": "💧 HYDROLOG METER REPORT", "weight": "bold", "color": "#ffffff", "size": "sm" },
        { "type": "text", "text": "ใบรายงานมิเตอร์น้ำ-ไฟประจำงวด", "color": "#e0f2fe", "size": "xs", "margin": "xs" }
      ]
    },
    "hero": {
      "type": "image",
      "url": displayImg,
      "size": "full",
      "aspectRatio": "16:9",
      "aspectMode": "cover"
    },
    "body": {
      "type": "box",
      "layout": "vertical",
      "spacing": "md",
      "contents": [
        {
          "type": "box",
          "layout": "horizontal",
          "contents": [
            { "type": "text", "text": "ห้อง " + room, "weight": "bold", "size": "xxl", "color": "#0f172a" },
            { "type": "text", "text": "รอบเดือนล่าสุด", "size": "xs", "color": "#64748b", "align": "end", "gravity": "center" }
          ]
        },
        { "type": "text", "text": "⏰ บันทึกเมื่อ: " + (timestamp || "ล่าสุด"), "size": "xs", "color": "#94a3b8" },
        { "type": "separator", "color": "#f1f5f9" },
        {
          "type": "box",
          "layout": "vertical",
          "spacing": "sm",
          "contents": [
            {
              "type": "box",
              "layout": "horizontal",
              "contents": [
                { "type": "text", "text": "สถานะการตรวจ", "size": "sm", "color": "#64748b" },
                { "type": "text", "text": "✅ สแกนสำเร็จ", "size": "sm", "color": "#16a34a", "align": "end", "weight": "bold" }
              ]
            }
          ]
        },
        {
          "type": "box",
          "layout": "horizontal",
          "backgroundColor": "#f0fdf4",
          "cornerRadius": "md",
          "paddingAll": "8px",
          "contents": [
            { "type": "text", "text": "🤖 ตรวจโดยหุ่นยนต์ 2WD (Raspberry Pi 5 + RapidOCR)", "size": "xxs", "color": "#16a34a" }
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
          "color": "#0284c7",
          "action": { "type": "uri", "label": "🔍 ดูรูปถ่ายความละเอียดสูง", "uri": displayImg }
        },
        {
          "type": "button",
          "style": "secondary",
          "action": { "type": "message", "label": "❌ แจ้งค่าน้ำผิด / ท่อรั่ว", "text": "แจ้งค่าน้ำผิด ห้อง " + room }
        }
      ]
    }
  };
}

function buildTenantPassFlex(room, fullName, phone) {
  return {
    "type": "bubble",
    "size": "mega",
    "header": {
      "type": "box",
      "layout": "vertical",
      "backgroundColor": "#10b981",
      "paddingTop": "16px",
      "paddingBottom": "16px",
      "contents": [
        { "type": "text", "text": "✅ ลงทะเบียนสำเร็จ", "weight": "bold", "color": "#ffffff", "size": "md" },
        { "type": "text", "text": "HYDROLOG DIGITAL TENANT PASS", "color": "#d1fae5", "size": "xxs", "margin": "xs" }
      ]
    },
    "body": {
      "type": "box",
      "layout": "vertical",
      "spacing": "md",
      "contents": [
        {
          "type": "box",
          "layout": "horizontal",
          "contents": [
            { "type": "text", "text": "ห้องพักของคุณ:", "size": "sm", "color": "#64748b" },
            { "type": "text", "text": "ห้อง " + room, "size": "xl", "color": "#10b981", "weight": "bold", "align": "end" }
          ]
        },
        { "type": "separator", "color": "#f1f5f9" },
        {
          "type": "box",
          "layout": "vertical",
          "spacing": "sm",
          "contents": [
            {
              "type": "box",
              "layout": "horizontal",
              "contents": [
                { "type": "text", "text": "ชื่อผู้เช่า", "size": "xs", "color": "#94a3b8" },
                { "type": "text", "text": fullName, "size": "xs", "color": "#334155", "align": "end", "weight": "bold" }
              ]
            },
            {
              "type": "box",
              "layout": "horizontal",
              "contents": [
                { "type": "text", "text": "เบอร์โทร", "size": "xs", "color": "#94a3b8" },
                { "type": "text", "text": phone, "size": "xs", "color": "#334155", "align": "end" }
              ]
            },
            {
              "type": "box",
              "layout": "horizontal",
              "contents": [
                { "type": "text", "text": "สถานะห้อง", "size": "xs", "color": "#94a3b8" },
                { "type": "text", "text": "🟢 ผูกบัญชีสำเร็จ (Active)", "size": "xs", "color": "#16a34a", "align": "end", "weight": "bold" }
              ]
            }
          ]
        },
        {
          "type": "box",
          "layout": "vertical",
          "backgroundColor": "#f8fafc",
          "cornerRadius": "md",
          "paddingAll": "10px",
          "contents": [
            { "type": "text", "text": "✨ ระบบจะส่งรูปภาพและรายงานค่าน้ำ-ค่าไฟมาให้คุณที่นี่โดยอัตโนมัติทุกสิ้นเดือนค่ะ~", "size": "xxs", "color": "#64748b", "wrap": true }
          ]
        }
      ]
    },
    "footer": {
      "type": "box",
      "layout": "horizontal",
      "spacing": "sm",
      "contents": [
        {
          "type": "button",
          "style": "primary",
          "color": "#0284c7",
          "action": { "type": "message", "label": "💧 เช็กค่าน้ำ", "text": "เช็กค่าน้ำ" }
        }
      ]
    }
  };
}

// ==========================================
// 📋 ตรวจสอบและขยายหัวคอลัมน์ในแท็บ Tenants ให้รองรับ Full_Name และ Phone
// ==========================================
function ensureTenantSheetHeaders(sheet) {
  if (!sheet) return;
  var lastCol = Math.max(sheet.getLastColumn(), 5);
  var headerRange = sheet.getRange(1, 1, 1, lastCol);
  var headers = headerRange.getValues()[0];
  var expected = ["Room", "Line_User_Id", "Registered_At", "Full_Name", "Phone"];
  for (var i = 0; i < expected.length; i++) {
    if (!headers[i] || headers[i].toString().trim() === "") {
      sheet.getRange(1, i + 1).setValue(expected[i]);
    }
  }
}

/**
 * ดึงแท็บข้อมูลผู้เช่า รองรับทั้งชื่อ 'Tenants' และชื่อเดิม 'Rooms' พร้อมเซ็ตหัวตารางอัตโนมัติ
 */
function getTenantSheet(ss) {
  var sheet = ss.getSheetByName(TENANT_SHEET_NAME);
  if (!sheet) {
    sheet = ss.getSheetByName("Rooms");
  }
  if (!sheet) {
    sheet = ss.insertSheet(TENANT_SHEET_NAME);
    sheet.appendRow(["Room", "Line_User_Id", "Registered_At", "Full_Name", "Phone"]);
  } else {
    ensureTenantSheetHeaders(sheet);
  }
  return sheet;
}

// ==========================================
// 📋 บันทึก / ค้นหาข้อมูลในแท็บผู้เช่า (1 ห้อง = 1 คน, ย้ายห้องต้องผ่านแอดมิน)
// ==========================================
function registerRoomTenant(roomNumber, userId, fullName, phone) {
  fullName = fullName || "";
  phone = phone || "";
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = getTenantSheet(ss);
    
    var data = sheet.getDataRange().getValues();
    var targetRow = -1;
    var currentOccupant = null;
    var previousRoom = null;
    
    for (var r = 1; r < data.length; r++) {
      var rNum = data[r][0].toString().trim();
      var rUser = data[r][1] ? data[r][1].toString().trim() : "";
      
      if (rNum === roomNumber.toString().trim()) {
        targetRow = r + 1;
        if (rUser !== "") currentOccupant = rUser;
      }
      
      if (rUser === userId.trim()) {
        previousRoom = { row: r + 1, room: rNum };
      }
    }
    
    // 1. ถ้าผู้เช่าคนนี้มีห้องเดิมอยู่แล้ว และไม่ใช่ห้องเดิม -> ไม่อนุญาตให้ย้ายเอง
    if (previousRoom && previousRoom.room !== roomNumber.toString().trim()) {
      return {
        success: false,
        status: "already_registered",
        currentRoom: previousRoom.room,
        room: roomNumber
      };
    }
    
    // 2. ถ้าห้องเป้าหมายมีผู้อื่นครองอยู่แล้ว -> ไม่อนุญาตให้ลงทะเบียนซ้ำ
    if (currentOccupant && currentOccupant !== userId.trim()) {
      return {
        success: false,
        status: "occupied",
        room: roomNumber
      };
    }
    
    var now = Utilities.formatDate(new Date(), "GMT+7", "dd/MM/yyyy HH:mm:ss");
    
    // 3. บันทึกห้องใหม่หรืออัปเดตข้อมูลผู้เช่า
    if (targetRow > 0) {
      sheet.getRange(targetRow, 2).setValue(userId);
      sheet.getRange(targetRow, 3).setValue(now);
      if (fullName !== "") sheet.getRange(targetRow, 4).setValue(fullName);
      if (phone !== "") sheet.getRange(targetRow, 5).setValue(phone);
    } else {
      sheet.appendRow([roomNumber.toString(), userId, now, fullName, phone]);
    }
    
    // 4. ซิงค์ข้อมูลข้ามไปยัง Supabase (Track 2) ทันที
    syncTenantToSupabase(roomNumber, userId, fullName, phone);
    
    return {
      success: true,
      status: "registered",
      room: roomNumber,
      fullName: fullName,
      phone: phone
    };
    
  } catch (e) {
    console.error("registerRoomTenant Error: " + e.toString());
    return { success: false, status: "error", message: e.toString() };
  }
}

// ==========================================
// 🔄 สถาปัตยกรรม Two-Way Sync ระหว่าง Google Sheets กับ Supabase Web App
// ==========================================

/**
 * จัดการ Action ที่ส่งมาจาก HydroLog Web App Console
 */
function handleWebConsoleAction(data) {
  var action = data.action;
  var room = data.room || data.room_number || data.roomNumber;
  
  if (action === "ping") {
    return ContentService.createTextOutput(JSON.stringify({
      status: "ok",
      message: "pong",
      timestamp: new Date().toISOString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
  
  // คำสั่ง: เตะ/ปลดผู้เช่าออกจากห้อง (Admin Web Console Kick Tenant)
  if (action === "kick_tenant" || action === "unlink_tenant") {
    if (!room) {
      return ContentService.createTextOutput(JSON.stringify({ status: "error", message: "Missing room parameter" }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    var unlinked = unbindTenantByRoom(room);
    return ContentService.createTextOutput(JSON.stringify({
      status: "ok",
      action: action,
      room: room,
      unlinked: unlinked,
      message: unlinked ? ("Unlinked room " + room + " from Google Sheet successfully") : ("Room " + room + " had no active tenant in Sheet")
    })).setMimeType(ContentService.MimeType.JSON);
  }
  
  // คำสั่ง: ซิงค์/บันทึกข้อมูลผู้เช่าจากหน้าเว็บ (Admin Web Console Save Tenant)
  if (action === "sync_tenant" || action === "save_tenant") {
    if (!room) {
      return ContentService.createTextOutput(JSON.stringify({ status: "error", message: "Missing room parameter" }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    var lineUserId = data.line_user_id || data.lineUserId || "";
    var fullName = data.full_name || data.fullName || "";
    var phone = data.phone || "";
    
    var synced = syncTenantFromWeb(room, lineUserId, fullName, phone);
    return ContentService.createTextOutput(JSON.stringify({
      status: "ok",
      action: action,
      room: room,
      synced: synced
    })).setMimeType(ContentService.MimeType.JSON);
  }
  
  // คำสั่ง: ดึงรายชื่อผู้เช่าทั้งหมดที่มีใน Google Sheets (Fetch All Tenants from Sheet)
  if (action === "get_tenants" || action === "list_tenants") {
    var sheetTenants = getTenantsFromSheet();
    return ContentService.createTextOutput(JSON.stringify({
      status: "ok",
      tenants: sheetTenants
    })).setMimeType(ContentService.MimeType.JSON);
  }
  
  return ContentService.createTextOutput(JSON.stringify({ status: "error", message: "Unknown action: " + action }))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * ดึงข้อมูลผู้เช่าทั้งหมดจาก Google Sheets แท็บ Tenants
 */
function getTenantsFromSheet() {
  var result = {};
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = getTenantSheet(ss);
    if (!sheet) return result;
    
    var data = sheet.getDataRange().getValues();
    for (var r = 1; r < data.length; r++) {
      var room = data[r][0] ? data[r][0].toString().trim() : "";
      var lineId = data[r][1] ? data[r][1].toString().trim() : "";
      var updated = data[r][2] ? data[r][2].toString().trim() : "";
      var fullName = data[r][3] ? data[r][3].toString().trim() : "";
      var phone = data[r][4] ? data[r][4].toString().trim() : "";
      if (room) {
        result[room] = {
          line_user_id: lineId,
          updated_at: updated,
          full_name: fullName,
          phone: phone
        };
      }
    }
  } catch (e) {
    console.error("getTenantsFromSheet Error: " + e.toString());
  }
  return result;
}

/**
 * ปลดผู้เช่าออกจากห้องใน Google Sheets โดยระบุเลขห้อง (เรียกจาก Web App)
 */
function unbindTenantByRoom(roomNumber) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = getTenantSheet(ss);
    if (!sheet) return false;
    
    var data = sheet.getDataRange().getValues();
    var unlinked = false;
    var now = Utilities.formatDate(new Date(), "GMT+7", "dd/MM/yyyy HH:mm:ss");
    
    for (var r = 1; r < data.length; r++) {
      var rNum = data[r][0].toString().trim();
      if (rNum === roomNumber.toString().trim()) {
        sheet.getRange(r + 1, 2).setValue("");
        sheet.getRange(r + 1, 3).setValue("Unlinked by Admin Web on " + now);
        unlinked = true;
      }
    }
    return unlinked;
  } catch (e) {
    console.error("unbindTenantByRoom Error: " + e.toString());
    return false;
  }
}

/**
 * บันทึกหรืออัปเดตข้อมูลผู้เช่าใน Google Sheets จากหน้าเว็บ Admin Console
 */
function syncTenantFromWeb(roomNumber, lineUserId, fullName, phone) {
  fullName = fullName || "";
  phone = phone || "";
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = getTenantSheet(ss);
    if (!sheet) return false;
    
    var data = sheet.getDataRange().getValues();
    var targetRow = -1;
    for (var r = 1; r < data.length; r++) {
      if (data[r][0].toString().trim() === roomNumber.toString().trim()) {
        targetRow = r + 1;
        break;
      }
    }
    var now = Utilities.formatDate(new Date(), "GMT+7", "dd/MM/yyyy HH:mm:ss");
    var note = lineUserId ? ("Updated by Admin Web on " + now) : ("Cleared by Admin Web on " + now);
    
    if (targetRow > 0) {
      sheet.getRange(targetRow, 2).setValue(lineUserId || "");
      sheet.getRange(targetRow, 3).setValue(note);
      sheet.getRange(targetRow, 4).setValue(fullName);
      sheet.getRange(targetRow, 5).setValue(phone);
    } else {
      sheet.appendRow([roomNumber.toString(), lineUserId || "", note, fullName, phone]);
    }
    return true;
  } catch (e) {
    console.error("syncTenantFromWeb Error: " + e.toString());
    return false;
  }
}

/**
 * ส่งข้อมูลผู้เช่าจาก LINE Webhook ไปอัปเดตตาราง room_tenants ใน Supabase REST API
 */
function syncTenantToSupabase(roomNumber, lineUserId, fullName, phone) {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return false;
    
    var url = SUPABASE_URL + "/rest/v1/room_tenants";
    var payload = {
      room_number: roomNumber.toString(),
      line_user_id: lineUserId || "",
      updated_at: new Date().toISOString()
    };
    if (fullName !== undefined && fullName !== "") payload.full_name = fullName;
    if (phone !== undefined && phone !== "") payload.phone = phone;

    var options = {
      method: "post",
      headers: {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": "Bearer " + SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates"
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };
    
    var response = UrlFetchApp.fetch(url, options);
    var statusCode = response.getResponseCode();
    console.log("Supabase Sync Response [" + statusCode + "]: " + response.getContentText());
    return statusCode >= 200 && statusCode < 300;
  } catch (e) {
    // ดักจับ error กรณี Supabase ยังไม่ได้รัน SQL เพื่อไม่ให้กระทบ LINE Bot Flow
    console.warn("syncTenantToSupabase Warning: " + e.toString());
    return false;
  }
}

function unbindTenantRoom(userId) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = getTenantSheet(ss);
    if (!sheet) return null;
    
    var data = sheet.getDataRange().getValues();
    for (var r = 1; r < data.length; r++) {
      if (data[r][1] && data[r][1].toString().trim() === userId.trim()) {
        var unRoom = data[r][0].toString();
        var now = Utilities.formatDate(new Date(), "GMT+7", "dd/MM/yyyy HH:mm:ss");
        sheet.getRange(r + 1, 2).setValue("");
        sheet.getRange(r + 1, 3).setValue("Unbound by user on " + now);
        return unRoom;
      }
    }
  } catch (e) {
    console.error("unbindTenantRoom Error: " + e.toString());
  }
  return null;
}

function getLineUserIdForRoom(roomNumber) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = getTenantSheet(ss);
    if (!sheet) return null;
    var data = sheet.getDataRange().getValues();
    for (var r = 1; r < data.length; r++) {
      if (data[r][0].toString() === roomNumber.toString()) {
        var id = data[r][1];
        if (id && id.toString().trim() !== "") return id.toString().trim();
      }
    }
  } catch (e) {
    console.error("getLineUserIdForRoom Error: " + e.toString());
  }
  return null;
}

// ==========================================
// 🔗 ฟังก์ชันแปลงลิงก์ Google Drive Viewer เป็น Direct Image Link (lh3.googleusercontent.com)
// ==========================================
function convertDriveUrlToDirect(url) {
  if (!url) return "";
  var strUrl = url.toString().trim();
  if (strUrl.indexOf("drive.google.com") !== -1) {
    var matchId = strUrl.match(/[-\w]{25,}/);
    if (matchId) {
      return "https://lh3.googleusercontent.com/d/" + matchId[0];
    }
  }
  return strUrl;
}

// ==========================================
// 📨 ส่งรูปมิเตอร์เข้า LINE ผู้เช่า
// ==========================================
function sendLineMessage(roomNumber, meterType, imageUrl) {
  var url = "https://api.line.me/v2/bot/message/push";
  var typeTH = (meterType === "water") ? "น้ำ" : "ไฟฟ้า";
  
  var targetUserId = getLineUserIdForRoom(roomNumber);
  var isFallback = false;
  
  if (!targetUserId) {
    targetUserId = DEFAULT_TEST_LINE_USER_ID;
    isFallback = true;
  }
  
  var lineImgUrl = convertDriveUrlToDirect(imageUrl);
  
  var caption = "📸 อัปเดตมิเตอร์" + typeTH + " ห้อง " + roomNumber + " เข้าระบบเรียบร้อยแล้วค่ะ!\n🔗 ดูรูปต้นฉบับ: " + imageUrl;
  if (isFallback) {
    caption = "⚠️ [แจ้งเตือนแอดมิน: ห้อง " + roomNumber + " ยังไม่มีผู้เช่าลงทะเบียน LINE]\n" + caption;
  }
  
  var payload = {
    "to": targetUserId,
    "messages": [
      {
        "type": "image",
        "originalContentUrl": lineImgUrl,
        "previewImageUrl": lineImgUrl
      },
      {
        "type": "text",
        "text": caption
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
  
  var res = UrlFetchApp.fetch(url, options);
  console.log("LINE Push Response [" + res.getResponseCode() + "]: " + res.getContentText());
}

function testRegisterAndSend() {
  registerRoomTenant("302", DEFAULT_TEST_LINE_USER_ID);
  sendLineMessage("302", "water", "https://images.unsplash.com/photo-1581092160562-40aa08e78837?w=1200&q=80");
  Logger.log("✅ ทดสอบส่งข้อความห้อง 302 เข้า LINE สำเร็จ!");
}

// ==========================================
// 🤖 ฟังก์ชันจัดการคำสั่งจาก Botnoi AI Chatbot API
// ==========================================
function handleBotnoiAction(data) {
  try {
    var rawAct = (data.action || data.Action || data.intent || data.Intent || "").toString().trim().toLowerCase();
    var action = rawAct;
    if (rawAct.indexOf("register") !== -1) {
      action = "botnoi_register";
    } else if (rawAct.indexOf("bill") !== -1 || rawAct.indexOf("meter") !== -1) {
      action = "botnoi_get_bill";
    } else if (rawAct.indexOf("dispute") !== -1 || rawAct.indexOf("issue") !== -1 || rawAct.indexOf("complaint") !== -1) {
      action = "botnoi_dispute";
    } else if (rawAct.indexOf("tenant") !== -1 || rawAct.indexOf("info") !== -1 || rawAct.indexOf("status") !== -1) {
      action = "botnoi_tenant_info";
    }

    var room = (data.room || data.room_number || data.roomNumber || "").toString().trim();
    var userId = (data.line_user_id || data.lineUserId || data.userId || data.user_id || data.botnoi_user_id || "").toString().trim();
    var fullName = (data.full_name || data.fullName || data.name || "").toString().trim();
    var phone = (data.phone || data.tel || data.phone_number || data.phoneNumber || "").toString().trim();
    var issueType = (data.issue_type || data.issueType || data.category || "แจ้งปัญหาทั่วไป").toString().trim();
    var description = (data.description || data.detail || data.message || "").toString().trim();

    // ----------------------------------------------------
    // Action 1: ลงทะเบียนผู้เช่า (Botnoi Register)
    // ----------------------------------------------------
    if (action === "botnoi_register") {
      // ตรวจสอบความถูกต้องของเลขห้อง (สกัดเลขห้อง 101 - 510 อย่างยืดหยุ่น เช่น 'ห้อง 302' หรือ '302')
      var extractedRoomMatch = room.match(/(?:^|\D)([1-5](?:0[1-9]|10))(?:\D|$)/);
      if (extractedRoomMatch) {
        room = extractedRoomMatch[1];
      } else {
        return ContentService.createTextOutput(JSON.stringify({
          status: "invalid_room",
          success: false,
          room: room,
          message: "⚠️ เลขห้อง " + (room || "ที่ระบุ") + " ไม่ถูกต้องค่ะ หอพักของเรารองรับห้อง 101 ถึง 510 ค่ะ"
        })).setMimeType(ContentService.MimeType.JSON);
      }
      
      if (!userId) {
        return ContentService.createTextOutput(JSON.stringify({
          status: "missing_userid",
          success: false,
          message: "⚠️ ไม่พบรหัส LINE User ID กรุณาลงทะเบียนผ่านแชท LINE เท่านั้นค่ะ"
        })).setMimeType(ContentService.MimeType.JSON);
      }
      
      var regResult = registerRoomTenant(room, userId, fullName, phone);
      
      if (regResult.status === "occupied") {
        return ContentService.createTextOutput(JSON.stringify({
          status: "occupied",
          success: false,
          room: room,
          message: "⚠️ ห้อง " + room + " มีผู้ลงทะเบียนไว้แล้วค่ะ\n\n" +
                   "• หากคุณพิมพ์เลขห้องผิด กรุณาลองพิมพ์ใหม่อีกครั้งนะคะ\n" +
                   "• หากเป็นผู้เช่าใหม่ กรุณาติดต่อแอดมินหอพักเพื่ออัปเดตสิทธิ์ห้องให้ค่ะ 🏢"
        })).setMimeType(ContentService.MimeType.JSON);
      }
      
      if (regResult.status === "already_registered") {
        return ContentService.createTextOutput(JSON.stringify({
          status: "already_registered",
          success: false,
          current_room: regResult.currentRoom,
          target_room: room,
          message: "ℹ️ บัญชี LINE ของคุณผูกอยู่กับห้อง " + regResult.currentRoom + " อยู่แล้วค่ะ\n\n" +
                   "🏢 การย้ายห้องจะต้องดำเนินการโดยแอดมินเท่านั้น กรุณาติดต่อแอดมินหอพักเพื่อขอย้ายห้องนะคะ"
        })).setMimeType(ContentService.MimeType.JSON);
      }
      
      var greetingName = fullName ? (" คุณ" + fullName) : "";
      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        success: true,
        room: room,
        full_name: fullName,
        phone: phone,
        message: "✅ ลงทะเบียนผูกห้อง " + room + " เรียบร้อยแล้วค่ะ! 🎉" + greetingName + "\n\n" +
                 "เมื่อหุ่นยนต์วิ่งไปสแกนมิเตอร์ห้องนี้ ระบบจะส่งรูปภาพและรายงานค่าน้ำมาให้คุณที่นี่โดยอัตโนมัติค่ะ 💧✨"
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // ----------------------------------------------------
    // Action 2: ตรวจสอบค่าน้ำ / ข้อมูลมิเตอร์ล่าสุด (Botnoi Get Bill)
    // ----------------------------------------------------
    if (action === "botnoi_get_bill" || action === "botnoi_check_bill" || action === "botnoi_latest_meter") {
      var targetRoom = room;
      if (!targetRoom && userId) {
        var userTenant = getRoomForLineUserId(userId);
        if (userTenant) {
          targetRoom = userTenant.room;
        }
      }
      
      if (!targetRoom) {
        return ContentService.createTextOutput(JSON.stringify({
          status: "not_registered",
          success: false,
          message: "ℹ️ คุณยังไม่ได้ลงทะเบียนเลขห้องพักค่ะ กรุณาพิมพ์ลงทะเบียนเลขห้องก่อนนะคะ เช่น 'ลงทะเบียน 302' 💧"
        })).setMimeType(ContentService.MimeType.JSON);
      }
      
      var latestMeter = getLatestMeterLogForRoom(targetRoom);
      if (!latestMeter) {
        return ContentService.createTextOutput(JSON.stringify({
          status: "no_data",
          success: true,
          room: targetRoom,
          message: "ℹ️ ห้อง " + targetRoom + " ยังไม่มีข้อมูลมิเตอร์ในระบบค่ะ หุ่นยนต์จะเข้ามาสแกนตรวจรอบถัดไปนะคะ 🤖"
        })).setMimeType(ContentService.MimeType.JSON);
      }
      
      var waterDirectUrl = convertDriveUrlToDirect(latestMeter.waterUrl);
      var elecDirectUrl = convertDriveUrlToDirect(latestMeter.elecUrl);
      
      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        success: true,
        room: targetRoom,
        timestamp: latestMeter.timestamp,
        water_image_url: waterDirectUrl,
        original_water_url: latestMeter.waterUrl,
        electricity_image_url: elecDirectUrl,
        original_elec_url: latestMeter.elecUrl,
        message: "📸 ข้อมูลมิเตอร์ล่าสุดของห้อง " + targetRoom + "\n" +
                 "⏰ บันทึกเมื่อ: " + latestMeter.timestamp + "\n" +
                 (latestMeter.waterUrl ? ("💧 มิเตอร์น้ำ: " + latestMeter.waterUrl + "\n") : "") +
                 (latestMeter.elecUrl ? ("⚡ มิเตอร์ไฟ: " + latestMeter.elecUrl) : "")
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // ----------------------------------------------------
    // Action 3: แจ้งปัญหา / ข้อพิพาทค่าน้ำ / ท่อรั่ว (Botnoi Dispute)
    // ----------------------------------------------------
    if (action === "botnoi_dispute" || action === "botnoi_report_issue" || action === "botnoi_complaint") {
      var disputeRoom = room;
      if (!disputeRoom && userId) {
        var userTenant = getRoomForLineUserId(userId);
        if (userTenant) {
          disputeRoom = userTenant.room;
          if (!phone && userTenant.phone) {
            phone = userTenant.phone;
          }
        }
      }
      
      if (!disputeRoom) {
        disputeRoom = "ไม่ระบุห้อง";
      }
      
      recordTenantDispute(disputeRoom, userId, issueType, description, phone);
      
      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        success: true,
        room: disputeRoom,
        issue_type: issueType,
        message: "✅ บันทึกเรื่องร้องเรียนของห้อง " + disputeRoom + " เรียบร้อยแล้วค่ะ! 🏢\n\n" +
                 "📌 หัวข้อ: " + issueType + "\n" +
                 "ระบบได้ส่งการแจ้งเตือนไปยังผู้ดูแลหอพักให้เรียบร้อยแล้ว แอดมินจะเร่งดำเนินการตรวจสอบให้ค่ะ 🛠️"
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // ----------------------------------------------------
    // Action 4: ตรวจสอบสถานะการลงทะเบียนของผู้ใช้ (Botnoi Tenant Info)
    // ----------------------------------------------------
    if (action === "botnoi_tenant_info" || action === "botnoi_check_status") {
      if (!userId) {
        return ContentService.createTextOutput(JSON.stringify({
          status: "missing_userid",
          success: false,
          message: "⚠️ ไม่พบ LINE User ID"
        })).setMimeType(ContentService.MimeType.JSON);
      }
      
      var tenant = getRoomForLineUserId(userId);
      if (tenant) {
        return ContentService.createTextOutput(JSON.stringify({
          status: "registered",
          is_registered: true,
          room: tenant.room,
          full_name: tenant.fullName,
          phone: tenant.phone,
          registered_at: tenant.registeredAt,
          message: "คุณผูกอยู่กับห้อง " + tenant.room + " เรียบร้อยแล้วค่ะ" + (tenant.fullName ? (" (" + tenant.fullName + ")") : "")
        })).setMimeType(ContentService.MimeType.JSON);
      } else {
        return ContentService.createTextOutput(JSON.stringify({
          status: "unregistered",
          is_registered: false,
          message: "คุณยังไม่ได้ลงทะเบียนห้องพักค่ะ"
        })).setMimeType(ContentService.MimeType.JSON);
      }
    }

    return ContentService.createTextOutput(JSON.stringify({
      status: "unknown_botnoi_action",
      success: false,
      message: "Unknown action: " + action
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    console.error("handleBotnoiAction Error: " + error.toString());
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      success: false,
      message: "Server Error: " + error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * ค้นหาข้อมูลห้องพักจาก LINE User ID
 */
function getRoomForLineUserId(userId) {
  if (!userId) return null;
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = getTenantSheet(ss);
    if (!sheet) return null;
    var data = sheet.getDataRange().getValues();
    for (var r = 1; r < data.length; r++) {
      var rUser = data[r][1] ? data[r][1].toString().trim() : "";
      if (rUser === userId.toString().trim()) {
        return {
          room: data[r][0].toString().trim(),
          registeredAt: data[r][2] ? data[r][2].toString().trim() : "",
          fullName: data[r][3] ? data[r][3].toString().trim() : "",
          phone: data[r][4] ? data[r][4].toString().trim() : ""
        };
      }
    }
  } catch (e) {
    console.error("getRoomForLineUserId Error: " + e.toString());
  }
  return null;
}

/**
 * ดึงข้อมูลมิเตอร์ล่าสุดของห้องที่ระบุจากแท็บ Log รูปถ่าย (ค้นหาย้อนหลังรวบรวมทั้งน้ำและไฟ)
 */
function getLatestMeterLogForRoom(roomNumber) {
  if (!roomNumber) return null;
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(SHEET_NAME) || ss.getSheetByName("Logs") || ss.getSheetByName("Sheet1") || ss.getSheetByName("Rooms") || ss.getSheets()[0];
    var data = sheet.getDataRange().getValues();
    
    var latestTimestamp = "";
    var latestWater = "";
    var latestElec = "";
    
    // ค้นหาย้อนหลัง (Bottom-Up) รวบรวมรูปล่าสุดทั้งน้ำและไฟของห้องนั้น
    for (var r = data.length - 1; r >= 1; r--) {
      var rNum = data[r][1] ? data[r][1].toString().trim() : "";
      if (rNum === roomNumber.toString().trim()) {
        if (!latestTimestamp && data[r][0]) latestTimestamp = data[r][0].toString();
        if (!latestWater && data[r][2]) latestWater = data[r][2].toString();
        if (!latestElec && data[r][3]) latestElec = data[r][3].toString();
        if (latestWater && latestElec) break;
      }
    }
    
    if (!latestTimestamp && !latestWater && !latestElec) return null;
    
    return {
      timestamp: latestTimestamp,
      room: roomNumber.toString().trim(),
      waterUrl: latestWater,
      elecUrl: latestElec
    };
  } catch (e) {
    console.error("getLatestMeterLogForRoom Error: " + e.toString());
  }
  return null;
}

/**
 * บันทึกเรื่องร้องเรียน/ข้อพิพาทลงชีต Disputes และแจ้งเตือนแอดมิน
 */
function recordTenantDispute(roomNumber, lineUserId, issueType, description, contactPhone) {
  var DISPUTE_SHEET_NAME = "Disputes";
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(DISPUTE_SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(DISPUTE_SHEET_NAME);
      sheet.appendRow(["Timestamp", "Room", "Line_User_Id", "Issue_Type", "Description", "Contact_Phone", "Status"]);
    }
    var now = Utilities.formatDate(new Date(), "GMT+7", "dd/MM/yyyy HH:mm:ss");
    sheet.appendRow([now, roomNumber.toString(), lineUserId || "", issueType || "แจ้งปัญหาทั่วไป", description || "", contactPhone || "", "Pending Review"]);
    
    // ส่งแจ้งเตือนตรงเข้า LINE แอดมินทันที
    sendLinePushAlertToAdmin(roomNumber, issueType, description, contactPhone);
    return true;
  } catch (e) {
    console.error("recordTenantDispute Error: " + e.toString());
    return false;
  }
}

/**
 * ส่ง LINE Push Message แจ้งเตือนแอดมินเมื่อมีผู้เช่าส่งเรื่องร้องเรียน
 */
function sendLinePushAlertToAdmin(roomNumber, issueType, description, contactPhone) {
  if (!DEFAULT_TEST_LINE_USER_ID) return;
  var timestamp = Utilities.formatDate(new Date(), "GMT+7", "dd/MM/yyyy HH:mm:ss");
  var alertText = "🚨 [แจ้งเตือนแอดมิน: มีเรื่องร้องเรียนจากผู้เช่า]\n" +
                  "🏢 ห้อง: " + roomNumber + "\n" +
                  "📌 เรื่อง: " + (issueType || "แจ้งปัญหาทั่วไป") + "\n" +
                  "📝 รายละเอียด: " + (description || "ไม่ได้ระบุรายละเอียด") + "\n" +
                  "📞 ติดต่อกลับ: " + (contactPhone || "ไม่ได้ระบุเบอร์โทร") + "\n" +
                  "⏰ เวลา: " + timestamp;
  
  var payload = {
    "to": DEFAULT_TEST_LINE_USER_ID,
    "messages": [
      {
        "type": "text",
        "text": alertText
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
  
  try {
    var res = UrlFetchApp.fetch("https://api.line.me/v2/bot/message/push", options);
    console.log("Admin Alert Push Response [" + res.getResponseCode() + "]: " + res.getContentText());
  } catch (err) {
    console.warn("sendLinePushAlertToAdmin Warning: " + err.toString());
  }
}

/**
 * ฟังก์ชันทดสอบระบบ Botnoi API ทั้งหมดใน Google Apps Script
 */
function testBotnoiApi() {
  Logger.log("=== 1. ทดสอบ Botnoi Register (ห้อง 303) ===");
  var regPayload = {
    action: "botnoi_register",
    room: "303",
    line_user_id: "U_TEST_BOTNOI_303",
    full_name: "นายทดสอบ บอทน้อย",
    phone: "0899998888"
  };
  var resReg = JSON.parse(handleBotnoiAction(regPayload).getContent());
  Logger.log("ผลการลงทะเบียน: " + JSON.stringify(resReg, null, 2));

  Logger.log("\n=== 2. ทดสอบ Botnoi Tenant Info ===");
  var infoPayload = {
    action: "botnoi_tenant_info",
    line_user_id: "U_TEST_BOTNOI_303"
  };
  var resInfo = JSON.parse(handleBotnoiAction(infoPayload).getContent());
  Logger.log("ข้อมูลผู้เช่า: " + JSON.stringify(resInfo, null, 2));

  Logger.log("\n=== 3. ทดสอบ Botnoi Dispute (แจ้งเรื่องร้องเรียน) ===");
  var disputePayload = {
    action: "botnoi_dispute",
    room: "303",
    line_user_id: "U_TEST_BOTNOI_303",
    issue_type: "ค่าน้ำผิดปกติ",
    description: "ตัวเลขในบิลเดือนนี้สูงกว่าปกติมาก ช่วยตรวจเช็กทีครับ",
    phone: "0899998888"
  };
  var resDispute = JSON.parse(handleBotnoiAction(disputePayload).getContent());
  Logger.log("ผลการแจ้งเรื่อง: " + JSON.stringify(resDispute, null, 2));

  Logger.log("\n=== 4. ทดสอบ Botnoi Get Bill ===");
  var billPayload = {
    action: "botnoi_get_bill",
    room: "303"
  };
  var resBill = JSON.parse(handleBotnoiAction(billPayload).getContent());
  Logger.log("ผลการดึงบิล: " + JSON.stringify(resBill, null, 2));
}

// ==========================================
// 📋 ฟังก์ชันสร้างแท็บตารางบันทึกผลการทดสอบระบบ (Manual Test Case Sheet)
// ==========================================
function createManualTestCaseSheet() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var tabName = "Manual_Test_Cases";
  var sheet = ss.getSheetByName(tabName);
  
  if (sheet) {
    sheet.clear();
    sheet.clearConditionalFormatRules();
  } else {
    sheet = ss.insertSheet(tabName);
  }
  
  sheet.getRange("A1:K1").merge().setValue("🧪 HydroLog & Robot - ตารางบันทึกผลการทดสอบระบบ (Manual Test Suite)")
    .setFontSize(14).setFontWeight("bold").setFontColor("#1E293B").setBackground("#F1F5F9")
    .setHorizontalAlignment("center").setVerticalAlignment("middle");
  sheet.setRowHeight(1, 40);

  var summaryCards = [
    { rangeTitle: "B2:C2", rangeVal: "B3:C3", title: "จำนวนเคสทั้งหมด", formula: '=COUNTA(A6:A25)', bg: "#EFF6FF", color: "#1D4ED8" },
    { rangeTitle: "D2:E2", rangeVal: "D3:E3", title: "✅ ผ่าน (Pass)", formula: '=COUNTIF(H6:H25, "Pass")', bg: "#F0FDF4", color: "#15803D" },
    { rangeTitle: "F2:G2", rangeVal: "F3:G3", title: "❌ ไม่ผ่าน (Fail)", formula: '=COUNTIF(H6:H25, "Fail")', bg: "#FEF2F2", color: "#B91C1C" },
    { rangeTitle: "H2:I2", rangeVal: "H3:I3", title: "⏳ ยังไม่ทดสอบ (Untested)", formula: '=COUNTIF(H6:H25, "Untested")', bg: "#F8FAFC", color: "#475569" },
    { rangeTitle: "J2:K2", rangeVal: "J3:K3", title: "📈 อัตราการผ่าน (Pass Rate)", formula: '=IFERROR(COUNTIF(H6:H25, "Pass") / (COUNTA(A6:A25) - COUNTIF(H6:H25, "Blocked")), 0)', bg: "#FAF5FF", color: "#6B21A8", isPercent: true }
  ];

  summaryCards.forEach(function(card) {
    sheet.getRange(card.rangeTitle).merge().setValue(card.title)
      .setFontSize(10).setFontWeight("bold").setFontColor(card.color).setBackground(card.bg)
      .setHorizontalAlignment("center").setVerticalAlignment("middle");
    
    var valCell = sheet.getRange(card.rangeVal).merge();
    valCell.setFormula(card.formula)
      .setFontSize(16).setFontWeight("bold").setFontColor(card.color).setBackground(card.bg)
      .setHorizontalAlignment("center").setVerticalAlignment("middle");
    
    if (card.isPercent) {
      valCell.setNumberFormat("0.0%");
    }
  });
  sheet.setRowHeight(2, 24);
  sheet.setRowHeight(3, 32);

  var headers = [
    "Test Case ID", "หมวดหมู่ (Category)", "หัวข้อการทดสอบ (Test Scenario)",
    "เงื่อนไขเริ่มต้น (Pre-conditions)", "ขั้นตอนการทดสอบ (Test Steps)",
    "ข้อมูลนำเข้า / ค่าทดสอบ (Test Data)", "ผลลัพธ์ที่คาดหวัง (Expected Result)",
    "สถานะ (Status)", "ชื่อผู้ทดสอบ (Tester)", "วันที่ทดสอบ (Test Date)",
    "สิ่งที่เกิดขึ้นจริง / หมายเหตุ (Notes)"
  ];

  var headerRange = sheet.getRange(5, 1, 1, headers.length);
  headerRange.setValues([headers])
    .setFontSize(11).setFontWeight("bold").setFontColor("#FFFFFF").setBackground("#1E3A8A")
    .setHorizontalAlignment("center").setVerticalAlignment("middle");
  sheet.setRowHeight(5, 36);

  var rows = [
    ["TC-REG-01", "1. LINE Bot - ลงทะเบียน", "แอด LINE OA ครั้งแรก (Follow Event)", "เพื่อนยังไม่เคยแอด LINE OA ของหอพัก", "1. สแกน QR Code หรือกด Add Friend จากลิงก์ LINE OA\n2. สังเกตข้อความแรกที่ระบบส่งมา", "บัญชี LINE ส่วนตัวของเพื่อน", "ได้รับข้อความต้อนรับจาก 'น้องไฮโดรจัง' พร้อมคำแนะนำวิธีพิมพ์ลงทะเบียนห้อง เช่น 'ลงทะเบียน 301' (101-510)", "Untested", "", "", ""],
    ["TC-REG-02", "1. LINE Bot - ลงทะเบียน", "ลงทะเบียนห้องแบบปกติถูกต้อง (Normal Flow)", "ห้อง 302 ยังว่าง (ยังไม่มีใครลงทะเบียน)", "1. พิมพ์ข้อความในแชท: 'ลงทะเบียน 302' หรือ '302'\n2. กดส่งข้อความ", "ลงทะเบียน 302", "ได้รับข้อความยืนยัน: '✅ คุณได้ลงทะเบียนผูกห้อง 302 สำเร็จแล้วค่ะ!' และใน Google Sheet แท็บ Rooms มี LINE User ID บันทึกตรงห้อง 302", "Untested", "", "", ""],
    ["TC-REG-03", "1. LINE Bot - ลงทะเบียน", "ลงทะเบียนภาษาไทยแบบไม่เว้นวรรค (Flexible Parsing)", "ห้อง 305 ยังว่าง", "1. พิมพ์ข้อความแบบติดกัน: 'ลงทะเบียนห้อง305' หรือ 'ลงทะเบียน305'\n2. กดส่งข้อความ", "ลงทะเบียนห้อง305", "ระบบตัดคำด้วย Regex ได้ถูกต้อง ตอบกลับยืนยันผูกห้อง 305 สำเร็จ", "Untested", "", "", ""],
    ["TC-REG-04", "1. LINE Bot - ลงทะเบียน", "ลงทะเบียนเลขห้องที่ไม่มีจริงนอกตึก (Out of Range)", "บัญชี LINE เพื่อนอยู่ในแชท", "1. พิมพ์เลขห้องเกินขอบเขต เช่น 'ลงทะเบียน 999' หรือ 'ลงทะเบียน 601' หรือ '001'\n2. กดส่งข้อความ", "ลงทะเบียน 999", "ระบบแจ้งเตือนว่า '⚠️ เลขห้องไม่ถูกต้องค่ะ หอพักของเรารองรับห้อง 101 ถึง 510 เท่านั้น' และไม่มีการบันทึกข้อมูล", "Untested", "", "", ""],
    ["TC-REG-05", "1. LINE Bot - ลงทะเบียน", "ผู้เช่าคนเดิมพิมพ์ลงทะเบียนห้องเดิมซ้ำ (Duplicate Self-Check)", "เพื่อนลงทะเบียนห้อง 302 สำเร็จแล้ว", "1. ใช้บัญชีเดิมพิมพ์ซ้ำ: 'ลงทะเบียน 302'\n2. กดส่งข้อความ", "ลงทะเบียน 302", "ระบบแจ้งเตือนอย่างสุภาพ: 'คุณได้ลงทะเบียนห้อง 302 ไว้อยู่แล้วค่ะ' ไม่เกิดข้อผิดพลาดและข้อมูลไม่พัง", "Untested", "", "", ""],
    ["TC-REG-06", "1. LINE Bot - ลงทะเบียน", "ลงทะเบียนทับห้องที่มีคนอื่นผูกไว้แล้ว (Quiet Rejection)", "เพื่อนคนที่ 1 ผูกห้อง 302 ไว้แล้ว", "1. ให้เพื่อนคนที่ 2 พิมพ์: 'ลงทะเบียน 302'\n2. สังเกตข้อความที่เพื่อนคนที่ 2 ได้รับ และตรวจสอบมือถือของเพื่อนคนที่ 1", "ลงทะเบียน 302 (จากบัญชีที่ 2)", "เพื่อนคนที่ 2 ได้รับข้อความ: '⚠️ ขออภัยค่ะ ห้อง 302 มีผู้เช่าลงทะเบียนแล้ว หากเป็นความผิดพลาดกรุณาติดต่อแอดมิน' และเพื่อนคนที่ 1 ต้องไม่ได้รับข้อความกวนใจใดๆ", "Untested", "", "", ""],
    ["TC-REG-07", "1. LINE Bot - ลงทะเบียน", "พิมพ์ข้อความทั่วไปที่ไม่ใช่คำสั่งลงทะเบียน (Fallback Message)", "บัญชี LINE เพื่อนอยู่ในแชท", "1. พิมพ์คำทั่วไป เช่น 'สวัสดี', 'ค่าน้ำหน่วยละกี่บาท', หรือส่งสติกเกอร์\n2. กดส่งข้อความ", "สวัสดีครับ", "บอทตอบกลับแนะนำตัว 'น้องไฮโดรจังพร้อมดูแลค่ะ!' พร้อมบอกวิธีพิมพ์ลงทะเบียนอย่างถูกต้อง ระบบไม่แครช", "Untested", "", "", ""],
    ["TC-BILL-01", "2. LINE Bot - แจ้งเตือนบิล", "ส่งแจ้งเตือนค่าน้ำตรงถึงห้องผู้เช่า (Dynamic Routing)", "เพื่อนผูกห้อง 302 ไว้ในระบบแล้ว", "1. ผู้ดูแลระบบสั่งรันฟังก์ชันส่งบิลค่าน้ำห้อง 302 (ผ่าน GAS หรือ Web Admin)\n2. เพื่อนตรวจสอบข้อความเข้าใน LINE", "Room: 302, Type: water, Sample Image URL", "เพื่อนได้รับข้อความ Push แจ้งเตือนค่าน้ำห้อง 302 มีภาพถ่ายมิเตอร์แสดงชัดเจน พร้อมข้อความและลิงก์ดูรูปภาพ", "Untested", "", "", ""],
    ["TC-BILL-02", "2. LINE Bot - แจ้งเตือนบิล", "เปิดดูรูปถ่ายมิเตอร์จาก LINE (Direct Image Access)", "ได้รับข้อความรูปภาพมิเตอร์ใน LINE แล้ว", "1. กดแตะขยายรูปภาพมิเตอร์ในแชท LINE\n2. กดคลิกลิงก์ URL ดูรูปต้นฉบับ", "กดแตะรูป / คลิกลิงก์", "รูปภาพแสดงผลได้ทันที คมชัด ไม่ขึ้น Error 'Permission Denied' หรือติดหน้าจอขอสิทธิ์ Google Drive", "Untested", "", "", ""],
    ["TC-BILL-03", "2. LINE Bot - แจ้งเตือนบิล", "ส่งบิลห้องที่ยังไม่มีผู้เช่าลงทะเบียน (Admin Fallback Route)", "ห้อง 105 ยังไม่มีผู้เช่าลงทะเบียน LINE", "1. สั่งส่งแจ้งเตือนค่าน้ำห้อง 105\n2. ตรวจสอบ LINE ของแอดมิน (DEFAULT_TEST_LINE_USER_ID)", "Room: 105, Type: water", "ระบบส่งข้อความเข้า LINE ของแอดมินแทน พร้อมหัวข้อ '⚠️ [แจ้งเตือนแอดมิน: ห้อง 105 ยังไม่มีผู้เช่าลงทะเบียน LINE]' เพื่อให้แอดมินรับทราบ", "Untested", "", "", ""],
    ["TC-WEB-01", "3. Web App - คอนโซลแอดมิน", "เปิดใช้งาน Web App เข้าสู่สิทธิ์แอดมินทันที (Open Admin Access)", "เปิดเว็บเบราว์เซอร์ (Chrome, Edge, Safari หรือมือถือ)", "1. เปิด URL เว็บแอป HydroLog\n2. สังเกตมุมขวาบนของหน้าเว็บ", "เปิดหน้าแรก ( / )", "เข้าใช้งานได้ทันที ไม่ขึ้นหน้าต่างบังคับล็อกอิน ที่มุมขวาบนแสดงแถบสีเขียว '🟢 Admin Mode' พร้อมสิทธิ์ Dorm Owner", "Untested", "", "", ""],
    ["TC-WEB-02", "3. Web App - คอนโซลแอดมิน", "เข้าสู่หน้าจัดการหอพักและห้องพัก 50 ห้อง (Dorm Admin Page)", "เปิดหน้า Web App แล้ว", "1. กดคลิกที่แท็บเมนู 'Dorm Admin' บนแถบด้านบน (หรือเปิด /admin)\n2. เลื่อนดูรายการห้องพัก", "คลิกเมนู /admin", "เปิดหน้า Dorm Admin ได้ทันที แสดงตารางจัดการผู้เช่าครบ 50 ห้อง (ชั้น 1 ถึงชั้น 5: 101-510)", "Untested", "", "", ""],
    ["TC-WEB-03", "3. Web App - คอนโซลแอดมิน", "ตรวจสอบสถานะการเชื่อมต่อ LINE ของผู้เช่าแต่ละห้อง", "เพื่อนลงทะเบียนห้อง 302 ใน LINE แล้ว", "1. ไปที่ห้อง 302 ในหน้า Dorm Admin\n2. ตรวจสอบสถานะการเชื่อมต่อ LINE", "ตรวจดูห้อง 302", "การ์ดห้อง 302 แสดงสถานะ 'เชื่อมต่อ LINE แล้ว' พร้อมแสดงข้อมูลเบื้องต้นอย่างถูกต้อง", "Untested", "", "", ""],
    ["TC-WEB-04", "3. Web App - คอนโซลแอดมิน", "แอดมินแก้ไขข้อมูลผู้เช่าด้วยตนเอง (Manual Assign / Edit)", "อยู่ในหน้า Dorm Admin", "1. กดปุ่มแก้ไขที่ห้อง 201\n2. กรอกชื่อผู้เช่า เช่น 'นายสมศักดิ์' และเบอร์โทร '0812345678'\n3. กดยืนยันบันทึกข้อมูล", "ชื่อ: นายสมศักดิ์, เบอร์โทร: 0812345678", "ข้อมูลอัปเดตทันทีในการ์ดห้อง 201 แสดงชื่อและเบอร์โทรที่กรอกไว้", "Untested", "", "", ""],
    ["TC-WEB-05", "3. Web App - คอนโซลแอดมิน", "แอดมินปลดหรือเตะผู้เช่าออกจากห้อง (Kick / Unlink Tenant)", "ห้อง 302 มีผู้เช่าผูกอยู่", "1. กดปุ่ม 'ปลดผู้เช่า' หรือ 'เตะออกจากห้อง' ที่ห้อง 302\n2. ยืนยันการทำรายการ", "กดปุ่มปลดผู้เช่าห้อง 302", "สถานะห้อง 302 เปลี่ยนกลับเป็น 'ห้องว่าง', รหัส LINE เดิมถูกล้างออก และเพื่อนสามารถนำ LINE เดิมไปผูกห้องใหม่ได้", "Untested", "", "", ""],
    ["TC-WEB-06", "3. Web App - คอนโซลแอดมิน", "ตรวจสอบประวัติภาพถ่ายและค่าน้ำย้อนหลัง (Logs & Photos Page)", "มีข้อมูลมิเตอร์ที่บันทึกแล้วในระบบ", "1. คลิกเมนู 'Logs & Photos' บนแถบนำทางด้านบน\n2. เลือกระบุชั้นหรือค้นหาเลขห้อง", "คลิกเมนู /logs", "แสดงแกลเลอรีรูปภาพมิเตอร์น้ำพร้อมป้ายกำกับ วันที่ เวลา และตัวเลขค่าน้ำที่อ่านได้ สามารถคลิกดูรูปขยายได้", "Untested", "", "", ""],
    ["TC-ROBOT-01", "4. ฮาร์ดแวร์หุ่นยนต์ & จอย", "กดปุ่มเลือกเลขห้องทีละห้อง (D-Pad UP / DOWN)", "เปิดบอร์ด ESP32 Main Drive และเชื่อมต่อบลูทูธจอยสติ๊กสำเร็จ", "1. สังเกตเลขห้องเริ่มต้น (101)\n2. กด D-Pad UP หนึ่งครั้ง แล้วกด D-Pad DOWN หนึ่งครั้ง", "D-Pad UP, D-Pad DOWN", "เมื่อกด UP เลขห้องเปลี่ยนเป็น 102, เมื่อกด DOWN เลขห้องลดกลับมาเป็น 101 เลขไม่กระโดดข้ามมั่ว", "Untested", "", "", ""],
    ["TC-ROBOT-02", "4. ฮาร์ดแวร์หุ่นยนต์ & จอย", "กดปุ่มกระโดดข้ามชั้น (D-Pad LEFT / RIGHT)", "จอยสติ๊กเชื่อมต่อกับบอร์ดแล้ว", "1. เริ่มที่ห้อง 101\n2. กด D-Pad RIGHT 1 ครั้ง\n3. กด D-Pad LEFT 1 ครั้ง", "D-Pad RIGHT, D-Pad LEFT", "กดขวา: เลขห้องกระโดดเป็น 201 (ชั้น 2), กดซ้าย: เลขห้องถอยกลับเป็น 101 (ชั้น 1) ไม่หลุดต่ำกว่า 101 หรือเกิน 510", "Untested", "", "", ""],
    ["TC-ROBOT-03", "4. ฮาร์ดแวร์หุ่นยนต์ & จอย", "เปิด-ปิดมอเตอร์กวาดขยะผ่านรีเลย์ (Sweep Motor Toggle)", "ต่อไฟเลี้ยงมอเตอร์กวาดและเชื่อมสายสัญญาณรีเลย์ Active LOW", "1. กดปุ่ม R1 บนจอยสติ๊ก\n2. สังเกตเสียงรีเลย์และแปรงปัด\n3. กดปุ่ม R1 ซ้ำอีกครั้ง", "ปุ่ม R1 บนจอย", "กดครั้งแรก: รีเลย์ส่งเสียงแต๊ก ไฟติด มอเตอร์แปรงปัดเริ่มหมุนกวาด, กดครั้งที่สอง: มอเตอร์หยุดหมุน รีเลย์ตัดวงจร", "Untested", "", "", ""],
    ["TC-ROBOT-04", "4. ฮาร์ดแวร์หุ่นยนต์ & จอย", "สั่งกล้องเซอร์โวก้มเงยและถ่ายภาพมิเตอร์ (Camera Tilt & Capture)", "หุ่นยนต์จอดหน้ามิเตอร์จำลอง และเชื่อมต่อ Wi-Fi เรียบร้อย", "1. กดปุ่มปรับมุมเซอร์โวให้กล้องตรงกับหน้าปัด\n2. กดปุ่มสั่งถ่ายภาพ", "ปุ่มสั่งถ่ายภาพบนจอย", "เซอร์โวขยับตามมุมที่กำหนด กล้องบันทึกภาพหน้าปัดมิเตอร์ และอัปโหลดขึ้น Google Drive พร้อมส่งแจ้งเตือนเข้า LINE", "Untested", "", "", ""]
  ];

  var dataRange = sheet.getRange(6, 1, rows.length, headers.length);
  dataRange.setValues(rows);
  dataRange.setVerticalAlignment("middle");

  var statusRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(["Pass", "Fail", "Blocked", "Untested"], true)
    .setAllowInvalid(false)
    .build();
  sheet.getRange(6, 8, rows.length, 1).setDataValidation(statusRule);

  var statusRange = sheet.getRange("H6:H25");
  var rules = [
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("Pass").setBackground("#DCFCE7").setFontColor("#15803D").setBold(true).setRanges([statusRange]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("Fail").setBackground("#FEE2E2").setFontColor("#B91C1C").setBold(true).setRanges([statusRange]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("Blocked").setBackground("#FEF3C7").setFontColor("#B45309").setBold(true).setRanges([statusRange]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("Untested").setBackground("#F1F5F9").setFontColor("#64748B").setRanges([statusRange]).build()
  ];
  sheet.setConditionalFormatRules(rules);

  sheet.setColumnWidth(1, 110);
  sheet.setColumnWidth(2, 160);
  sheet.setColumnWidth(3, 240);
  sheet.setColumnWidth(4, 200);
  sheet.setColumnWidth(5, 280);
  sheet.setColumnWidth(6, 180);
  sheet.setColumnWidth(7, 280);
  sheet.setColumnWidth(8, 120);
  sheet.setColumnWidth(9, 130);
  sheet.setColumnWidth(10, 120);
  sheet.setColumnWidth(11, 240);

  sheet.getRange("C6:G25").setWrap(true);
  sheet.getRange("K6:K25").setWrap(true);
  sheet.getRange("A6:A25").setHorizontalAlignment("center");
  sheet.getRange("H6:H25").setHorizontalAlignment("center");
  sheet.getRange("J6:J25").setHorizontalAlignment("center");

  sheet.getRange(5, 1, rows.length + 1, headers.length)
    .setBorder(true, true, true, true, true, true, "#CBD5E1", SpreadsheetApp.BorderStyle.SOLID);
  sheet.setFrozenRows(5);

  Logger.log("🎉 สร้างแท็บ 'Manual_Test_Cases' ใน Google Sheet เรียบร้อยแล้ว!");
  Logger.log("🔗 เปิดดูได้ที่: " + ss.getUrl() + "#gid=" + sheet.getSheetId());
  return ss.getUrl() + "#gid=" + sheet.getSheetId();
}

