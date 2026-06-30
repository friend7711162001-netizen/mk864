/**
 * 宿管家民宿管理儀表板 - 後端指令碼 (Google Apps Script)
 * 
 * 使用說明：
 * 1. 在 Google 試算表中，點選「擴充功能」 > 「Apps Script」。
 * 2. 將此檔案的內容完整貼入。
 * 3. 點選「部署」 > 「新增部署」。
 * 4. 類型選擇「網頁應用程式」。
 * 5. 「誰可以用有權存取」設定為「任何人」(Anyone)，「執行身分」設定為「我」(Me)。
 * 6. 部署後複製「網頁應用程式 URL」，將其填入前端的 `config.js` 中。
 * 7. 第一次部署後，可以在網頁端點選「初始化工作表」按鈕，或手動在 GAS 中執行 `initSheets` 函式以自動建立所有工作表。
 */

// 預設收件信箱
const DEFAULT_EMAIL = "service@yaling-hotel.tw";

// 系統登入密碼 (必須與前端 config.js 中的密碼保持一致)
const LOGIN_PASSWORD = "496527";

/**
 * 驗證前端傳來的密碼是否正確
 */
function checkAuth(e) {
  let clientPassword = "";
  if (e && e.parameter && e.parameter.password) {
    clientPassword = e.parameter.password;
  } else if (e && e.postData && e.postData.contents) {
    try {
      const data = JSON.parse(e.postData.contents);
      clientPassword = data.password;
    } catch(err) {}
  }
  return clientPassword === LOGIN_PASSWORD;
}

/**
 * 處理 GET 請求：讀取所有工作表的資料並回傳 JSON
 */
function doGet(e) {
  // 驗證存取密碼
  if (!checkAuth(e)) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: '密碼錯誤，拒絕存取！' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    
    // 取得各個工作表，若不存在則回傳空陣列
    const todos = getSheetData(ss.getSheetByName('待辦清單'), true);
    const shuttle = getSheetData(ss.getSheetByName('接送機'), true);
    const dailyChecklist = getSheetData(ss.getSheetByName('每日檢點'), true);
    const dailyTasks = getSheetData(ss.getSheetByName('每日任務'), false); // 任務不需要 ID 欄位對應
    const deposits = getSheetData(ss.getSheetByName('訂金表'), false); // 訂金以訂編為主鍵
    const routineConfig = getSheetData(ss.getSheetByName('例行項目配置'), false);

    const result = {
      status: 'success',
      data: {
        todos: todos,
        shuttle: shuttle,
        dailyChecklist: dailyChecklist,
        dailyTasks: dailyTasks,
        deposits: deposits,
        routineConfig: routineConfig
      }
    };
    
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * 處理 POST 請求：處理新增、修改、刪除與發送郵件等操作
 */
function doPost(e) {
  // 驗證存取密碼
  if (!checkAuth(e)) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: '密碼錯誤，拒絕存取！' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  try {
    const params = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const action = params.action;
    
    let result = { status: 'success' };
    
    switch (action) {
      case 'initSheets':
        initSheets();
        result.message = '工作表初始化成功';
        break;
        
      case 'saveTodo':
        saveRow('待辦清單', params.data, 'ID');
        break;
      case 'deleteTodo':
        deleteRow('待辦清單', params.id, 'ID');
        break;
        
      case 'saveShuttle':
        saveRow('接送機', params.data, 'ID');
        break;
      case 'deleteShuttle':
        deleteRow('接送機', params.id, 'ID');
        break;
        
      case 'saveDailyCheck':
        saveRow('每日檢點', params.data, 'ID');
        break;
        
      case 'saveDailyTask':
        // 每日任務由「日期」與「任務名稱」共同決定唯一性
        saveDailyTaskRow(params.data);
        break;
        
      case 'saveDeposit':
        saveRow('訂金表', params.data, '訂編');
        break;
      case 'deleteDeposit':
        deleteRow('訂金表', params.id, '訂編');
        break;
        
      case 'saveRoutineConfigItem':
        saveRow('例行項目配置', { '項目名稱': params.name }, '項目名稱');
        break;
      case 'deleteRoutineConfigItem':
        deleteRow('例行項目配置', params.name, '項目名稱');
        break;
        
      case 'sendShuttleEmail':
        sendShuttleEmail(params.date, params.email || DEFAULT_EMAIL);
        result.message = '郵件發送成功';
        break;
        
      default:
        throw new Error('未知的操作指令：' + action);
    }
    
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * 自動初始化工作表與欄位標題
 */
function initSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // 1. 待辦清單
  let todoSheet = ss.getSheetByName('待辦清單');
  if (!todoSheet) {
    todoSheet = ss.insertSheet('待辦清單');
    todoSheet.appendRow(['ID', '內容', '是否完成', '建立時間']);
  }
  
  // 2. 接送機
  let shuttleSheet = ss.getSheetByName('接送機');
  if (!shuttleSheet) {
    shuttleSheet = ss.insertSheet('接送機');
    shuttleSheet.appendRow(['ID', '類型', '日期', '飯店', '房號', '姓名', '電話', '起飛時間', '送機時間', '班次/航班', '人數', '備註', '司機', '是否確認', '入住天數']);
  } else {
    // 檢查是否已存在入住天數欄位，若無則補上
    const headers = shuttleSheet.getDataRange().getValues()[0];
    if (headers.indexOf('入住天數') === -1) {
      shuttleSheet.getRange(1, headers.length + 1).setValue('入住天數');
    }
  }
  
  // 3. 每日檢點 (房況)
  let dailySheet = ss.getSheetByName('每日檢點');
  if (!dailySheet) {
    dailySheet = ss.insertSheet('每日檢點');
    dailySheet.appendRow(['ID', '日期', '房號', '人數', '明日早餐', '時間', '清/不清', '民宿送機', '續退', '是否確認', '備註']);
  }

  // 4. 每日任務狀態
  let dailyTasksSheet = ss.getSheetByName('每日任務');
  if (!dailyTasksSheet) {
    dailyTasksSheet = ss.insertSheet('每日任務');
    dailyTasksSheet.appendRow(['日期', '任務名稱', '是否完成']);
  }
  
  // 5. 訂金表
  let depositSheet = ss.getSheetByName('訂金表');
  if (!depositSheet) {
    depositSheet = ss.insertSheet('訂金表');
    depositSheet.appendRow(['訂編', '匯款日期', '入住日', '姓名', '金額', '訂/尾', '匯編', '狀態']);
  }

  // 6. 例行項目配置
  let routineConfigSheet = ss.getSheetByName('例行項目配置');
  if (!routineConfigSheet) {
    routineConfigSheet = ss.insertSheet('例行項目配置');
    routineConfigSheet.appendRow(['項目名稱']);
    // 寫入預設的 17 項例行任務
    const defaultTasks = [
      "續住整理", "補樓梯間備品", "通知洗衣廠", "通知清潔人員",
      "行程船票開立", "傳明日接送機表", "預訂明日早餐", "與客核對接送機",
      "點錢", "傳明日入住資訊", "KEY訂金", "刷卡機結帳",
      "開入住小白單", "KEY行程", "大小毛歸位", "KEY洗衣單", "準備床被單"
    ];
    defaultTasks.forEach(task => {
      routineConfigSheet.appendRow([task]);
    });
  }
}

/**
 * 輔助函式：取得指定工作表的資料並轉換為 JSON 物件陣列
 */
function getSheetData(sheet, hasDateObj) {
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return []; // 只有標題列
  
  const headers = data[0];
  const rows = [];
  const timeZone = Session.getScriptTimeZone();
  
  for (let i = 1; i < data.length; i++) {
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      let value = data[i][j];
      
      // 處理 Date 物件以避免轉 JSON 時時區偏離，統一轉為 YYYY-MM-DD
      if (value instanceof Date) {
        // 如果是單純的日期，格式化為 YYYY-MM-DD，若是時間則保留
        if (value.getHours() === 0 && value.getMinutes() === 0 && value.getSeconds() === 0) {
          value = Utilities.formatDate(value, timeZone, "yyyy-MM-dd");
        } else {
          value = Utilities.formatDate(value, timeZone, "yyyy-MM-dd HH:mm:ss");
        }
      }
      row[headers[j]] = value;
    }
    rows.push(row);
  }
  return rows;
}

/**
 * 輔助函式：新增或更新工作表中的某一行資料 (依據 Key 鍵值判斷)
 */
function saveRow(sheetName, rowData, keyName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('找不到工作表：' + sheetName);
  
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const keyIndex = headers.indexOf(keyName);
  if (keyIndex === -1) throw new Error('在工作表 ' + sheetName + ' 中找不到 Key 欄位：' + keyName);
  
  // 組合要寫入的陣列資料
  const newRowValues = headers.map(h => {
    let val = rowData[h];
    if (val === undefined) return "";
    
    // 如果是字串且以 0 開頭後面全是數字（且長度大於 1），加上單引號前綴以防止 Google 試算表吃掉開頭的 0
    if (typeof val === 'string' && /^0\d+$/.test(val)) {
      return "'" + val;
    }
    return val;
  });
  
  const keyValue = rowData[keyName];
  let foundIndex = -1;
  
  // 尋找是否已有相同 Key 的資料列
  for (let i = 1; i < data.length; i++) {
    if (data[i][keyIndex].toString() === keyValue.toString()) {
      foundIndex = i + 1; // 轉為 1-based index
      break;
    }
  }
  
  if (foundIndex !== -1) {
    // 找到重複的 Key，進行更新
    const range = sheet.getRange(foundIndex, 1, 1, headers.length);
    range.setValues([newRowValues]);
  } else {
    // 未找到，新增一行
    sheet.appendRow(newRowValues);
  }
}

/**
 * 輔助編寫：針對每日任務（複合鍵：日期 + 任務名稱）進行更新或新增
 */
function saveDailyTaskRow(rowData) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('每日任務');
  if (!sheet) return;
  
  const data = sheet.getDataRange().getValues();
  let foundIndex = -1;
  
  // 比對日期與任務名稱
  for (let i = 1; i < data.length; i++) {
    const rowDate = data[i][0] instanceof Date ? 
      Utilities.formatDate(data[i][0], Session.getScriptTimeZone(), "yyyy-MM-dd") : data[i][0].toString();
    
    if (rowDate === rowData.日期 && data[i][1].toString() === rowData.任務名稱.toString()) {
      foundIndex = i + 1;
      break;
    }
  }
  
  const rowValues = [rowData.日期, rowData.任務名稱, rowData.是否完成];
  if (foundIndex !== -1) {
    sheet.getRange(foundIndex, 1, 1, 3).setValues([rowValues]);
  } else {
    sheet.appendRow(rowValues);
  }
}

/**
 * 輔助函式：刪除指定工作表中的某一行資料
 */
function deleteRow(sheetName, keyValue, keyName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('找不到工作表：' + sheetName);
  
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const keyIndex = headers.indexOf(keyName);
  if (keyIndex === -1) throw new Error('找不到 Key 欄位：' + keyName);
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][keyIndex].toString() === keyValue.toString()) {
      sheet.deleteRow(i + 1);
      return;
    }
  }
  throw new Error('找不到要刪除的資料，Key：' + keyValue);
}

/**
 * 核心功能：發送接送機時刻表郵件
 */
function sendShuttleEmail(dateStr, targetEmail) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('接送機');
  if (!sheet) throw new Error('找不到「接送機」工作表');
  
  const allData = getSheetData(sheet, true);
  
  // 篩選出指定日期的接送機資料
  const dayList = allData.filter(row => row.日期 === dateStr);
  
  const arrivals = dayList.filter(row => row.類型 === '接機');
  const departures = dayList.filter(row => row.類型 === '送機');
  
  // 產生 HTML 郵件內容
  let htmlBody = `
    <div style="font-family: 'Microsoft JhengHei', sans-serif; max-width: 800px; margin: 0 auto; color: #333; padding: 20px; background-color: #F8F6F0; border-radius: 8px;">
      <div style="background-color: #4A6B5D; color: white; padding: 15px 20px; border-radius: 6px 6px 0 0; margin-bottom: 20px;">
        <h2 style="margin: 0; font-size: 20px; font-weight: normal; letter-spacing: 1px;">民宿接送機</h2>
        <p style="margin: 5px 0 0 0; font-size: 20px; opacity: 0.9;">日期：${dateStr}</p>
      </div>
  `;
  
  // --- 接機表格 ---
  htmlBody += `<h3 style="color: #4A6B5D; border-left: 4px solid #4A6B5D; padding-left: 10px; margin-top: 25px;">🛬 今日接機清單 (${arrivals.length} 筆)</h3>`;
  if (arrivals.length === 0) {
    htmlBody += `<p style="color: #666; font-style: italic; padding: 10px;">今日無接機行程。</p>`;
  } else {
    htmlBody += `
      <div style="overflow-x: auto;">
        <table style="width: 100%; border-collapse: collapse; background-color: white; font-size: 13px; margin-bottom: 15px; border-radius: 4px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
          <thead>
            <tr style="background-color: #EAECE9; text-align: left; border-bottom: 2px solid #D2D7D0;">
              <th style="padding: 10px; border: 1px solid #E1E5E0;">飯店</th>
              <th style="padding: 10px; border: 1px solid #E1E5E0;">姓名</th>
              <th style="padding: 10px; border: 1px solid #E1E5E0;">電話</th>
              <th style="padding: 10px; border: 1px solid #E1E5E0;">出發/航班</th>
              <th style="padding: 10px; border: 1px solid #E1E5E0;">起飛</th>
              <th style="padding: 10px; border: 1px solid #E1E5E0;">到達</th>
              <th style="padding: 10px; border: 1px solid #E1E5E0;">人數</th>
              <th style="padding: 10px; border: 1px solid #E1E5E0;">司機</th>
              <th style="padding: 10px; border: 1px solid #E1E5E0;">備註</th>
            </tr>
          </thead>
          <tbody>
    `;
    arrivals.forEach(row => {
      htmlBody += `
        <tr style="border-bottom: 1px solid #E1E5E0;">
          <td style="padding: 10px; border: 1px solid #E1E5E0; font-weight: bold; color: #4A6B5D;">${row.飯店 || ''}</td>
          <td style="padding: 10px; border: 1px solid #E1E5E0;">${row.姓名 || ''}</td>
          <td style="padding: 10px; border: 1px solid #E1E5E0; white-space: nowrap;">${row.電話 || ''}</td>
          <td style="padding: 10px; border: 1px solid #E1E5E0;">${row['班次/航班'] || ''}</td>
          <td style="padding: 10px; border: 1px solid #E1E5E0; text-align: center;">${row.起飛時間 || ''}</td>
          <td style="padding: 10px; border: 1px solid #E1E5E0; text-align: center; font-weight: bold; background-color: #FFF5F0; color: #D98A6C;">${row.送機時間 || ''}</td>
          <td style="padding: 10px; border: 1px solid #E1E5E0; text-align: center; font-weight: bold;">${row.人數 || ''}</td>
          <td style="padding: 10px; border: 1px solid #E1E5E0; font-weight: bold; color: #2E4037;">${row.司機 || ''}</td>
          <td style="padding: 10px; border: 1px solid #E1E5E0; color: #666; font-size: 12px;">${row.備註 || ''}</td>
        </tr>
      `;
    });
    htmlBody += `</tbody></table></div>`;
  }
  
  // --- 送機表格 ---
  htmlBody += `<h3 style="color: #D98A6C; border-left: 4px solid #D98A6C; padding-left: 10px; margin-top: 30px;">🛫 今日送機清單 (${departures.length} 筆)</h3>`;
  if (departures.length === 0) {
    htmlBody += `<p style="color: #666; font-style: italic; padding: 10px;">今日無送機行程。</p>`;
  } else {
    htmlBody += `
      <div style="overflow-x: auto;">
        <table style="width: 100%; border-collapse: collapse; background-color: white; font-size: 13px; margin-bottom: 15px; border-radius: 4px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
          <thead>
            <tr style="background-color: #FFF2ED; text-align: left; border-bottom: 2px solid #F6DDD4;">
              <th style="padding: 10px; border: 1px solid #F2E3DE;">飯店</th>
              <th style="padding: 10px; border: 1px solid #F2E3DE;">房號</th>
              <th style="padding: 10px; border: 1px solid #F2E3DE;">姓名</th>
              <th style="padding: 10px; border: 1px solid #F2E3DE;">電話</th>
              <th style="padding: 10px; border: 1px solid #F2E3DE;">起飛</th>
              <th style="padding: 10px; border: 1px solid #F2E3DE;">送機時間</th>
              <th style="padding: 10px; border: 1px solid #F2E3DE;">人數</th>
              <th style="padding: 10px; border: 1px solid #F2E3DE;">司機</th>
              <th style="padding: 10px; border: 1px solid #F2E3DE;">備註</th>
            </tr>
          </thead>
          <tbody>
    `;
    departures.forEach(row => {
      htmlBody += `
        <tr style="border-bottom: 1px solid #F2E3DE;">
          <td style="padding: 10px; border: 1px solid #F2E3DE; font-weight: bold; color: #4A6B5D;">${row.飯店 || ''}</td>
          <td style="padding: 10px; border: 1px solid #F2E3DE; font-weight: bold; text-align: center;">${row.房號 || ''}</td>
          <td style="padding: 10px; border: 1px solid #F2E3DE;">${row.姓名 || ''}</td>
          <td style="padding: 10px; border: 1px solid #F2E3DE; white-space: nowrap;">${row.電話 || ''}</td>
          <td style="padding: 10px; border: 1px solid #F2E3DE; text-align: center;">${row.起飛時間 || ''}</td>
          <td style="padding: 10px; border: 1px solid #F2E3DE; text-align: center; font-weight: bold; background-color: #FFF5F0; color: #D98A6C;">${row.送機時間 || ''}</td>
          <td style="padding: 10px; border: 1px solid #F2E3DE; text-align: center; font-weight: bold;">${row.人數 || ''}</td>
          <td style="padding: 10px; border: 1px solid #F2E3DE; font-weight: bold; color: #2E4037;">${row.司機 || ''}</td>
          <td style="padding: 10px; border: 1px solid #F2E3DE; color: #666; font-size: 12px;">${row.備註 || ''}</td>
        </tr>
      `;
    });
    htmlBody += `</tbody></table></div>`;
  }
  
  htmlBody += `
      <div style="margin-top: 30px; border-top: 1px solid #E1E5E0; padding-top: 15px; font-size: 12px; color: #888; text-align: center;">
        此郵件由自動發送。請勿直接回覆。
      </div>
    </div>
  `;
  
  // 發送電子郵件
  MailApp.sendEmail({
    to: targetEmail,
    subject: `【民宿接送機】${dateStr} `,
    htmlBody: htmlBody
  });
}
