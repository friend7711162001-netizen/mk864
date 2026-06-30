/**
 * 宿管家民宿管理儀表板 - 前端 JavaScript 主程式
 * 
 * 包含狀態管理、資料庫同步、UI 渲染與互動邏輯。
 * 支援「離線展示模式」（若 CONFIG.GAS_URL 未設定或失效，資料會暫存在 LocalStorage）。
 */

// 應用程式核心狀態 (State)
let state = {
    todos: [],          // 待辦事項 (全域)
    shuttle: [],        // 接送機行程 (日期相關)
    dailyChecklist: [], // 每日房況檢點 (日期相關)
    dailyTasks: [],     // 每日 17 項例行任務狀態 (日期相關)
    deposits: [],       // 訂金紀錄 (全域，以編號或入住日排序)
    routineTasksList: [ // 例行項目配置 (預設值，同步時由試算表覆蓋)
        "續住整理", "補樓梯間備品", "通知洗衣廠", "通知清潔人員",
        "行程船票開立", "傳明日接送機表", "預訂明日早餐", "與客核對接送機",
        "點錢", "傳明日入住資訊", "KEY訂金", "刷卡機結帳",
        "開入住小白單", "KEY行程", "大小毛歸位", "KEY洗衣單", "準備床被單"
    ],
    targetDate: "",     // 當前選定的操作日期 (格式: YYYY-MM-DD)
    currentDepositFilter: 'all', // 訂金篩選狀態
    currentTodoFilter: 'pending', // 待辦篩選狀態
    isConnected: false  // 是否成功連線到 Google Sheets
};

// 固定房間清單 (依圖片 1 順序)
const FIXED_ROOMS = ["202", "302", "201", "301"];

// 初始化應用程式
document.addEventListener("DOMContentLoaded", () => {
    initDate();
    initEmailSetting();
    initEventListeners();

    // 檢查並初始化登入狀態
    checkLoginState();
});

/**
 * 輔助函數：將簡寫日期（如 6/30 或 30）解析為標準 YYYY-MM-DD
 */
function parseInputDate(inputStr) {
    if (!inputStr) return "";
    const cleanStr = inputStr.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(cleanStr)) return cleanStr;

    const today = new Date();
    const currentYear = today.getFullYear();

    // 匹配 M/D 或 MM/DD 或 M-D 等格式
    const match = cleanStr.match(/^(\d{1,2})[\/\-](\d{1,2})$/);
    if (match) {
        const month = String(match[1]).padStart(2, '0');
        const day = String(match[2]).padStart(2, '0');
        return `${currentYear}-${month}-${day}`;
    }

    // 匹配單純日期 DD (假設為當前月份)
    if (/^\d{1,2}$/.test(cleanStr)) {
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(cleanStr).padStart(2, '0');
        return `${currentYear}-${month}-${day}`;
    }

    return cleanStr;
}

/**
 * 輔助函數：將標準 YYYY-MM-DD 轉為 M/D 顯示格式 (如 6/30)
 */
function formatDisplayDate(dateStr) {
    if (!dateStr) return "";
    const parts = dateStr.split('-');
    if (parts.length === 3) {
        return `${parseInt(parts[1])}/${parseInt(parts[2])}`;
    }
    return dateStr;
}

/**
 * 初始化日期：預設為今天
 */
function initDate() {
    const today = new Date();
    state.targetDate = formatDateString(today);
    document.getElementById("target-date").value = state.targetDate;
}

/**
 * 初始化預設收件信箱
 */
function initEmailSetting() {
    const emailInput = document.getElementById("shuttle-email");
    if (emailInput && typeof CONFIG !== "undefined") {
        emailInput.value = CONFIG.DEFAULT_EMAIL || "service@yaling-hotel.tw";
    }
}

/**
 * 格式化 Date 物件為 YYYY-MM-DD
 */
function formatDateString(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/**
 * 註冊所有的 UI 事件監聽器
 */
function initEventListeners() {
    // 1. 日期切換
    const dateInput = document.getElementById("target-date");
    dateInput.addEventListener("change", (e) => {
        state.targetDate = e.target.value;
        renderAll();
    });

    document.getElementById("btn-prev-day").addEventListener("click", () => {
        adjustDate(-1);
    });

    document.getElementById("btn-next-day").addEventListener("click", () => {
        adjustDate(1);
    });

    // 2. 頁籤切換 (Tabs)
    const tabButtons = document.querySelectorAll(".tab-btn");
    tabButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            tabButtons.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");

            const tabId = btn.dataset.tab;
            document.querySelectorAll(".tab-pane").forEach(pane => {
                pane.classList.remove("active");
            });
            document.getElementById(tabId).classList.add("active");
        });
    });

    // 3. 同步按鈕與初始化試算表
    document.getElementById("btn-sync").addEventListener("click", () => {
        syncData(true);
    });

    document.getElementById("btn-init-sheets").addEventListener("click", () => {
        if (confirm("確定要初始化 Google 試算表嗎？這將會在試算表中自動建立「待辦清單」、「接送機」、「每日檢點」、「每日任務」和「訂金表」工作表。")) {
            executeBackendAction("initSheets", {});
        }
    });

    // 4. 待辦清單新增
    document.getElementById("btn-add-todo").addEventListener("click", addNewTodo);
    document.getElementById("new-todo-text").addEventListener("keypress", (e) => {
        if (e.key === "Enter") addNewTodo();
    });

    // 5. 房況已改為表格內直接點擊編輯 (Inline Edit)，無須彈窗控制

    // 6. 接送機表格內直接新增儲存 (Inline Add)
    document.getElementById("btn-save-arr").addEventListener("click", () => saveNewShuttle("接機"));
    document.getElementById("btn-save-dep").addEventListener("click", () => saveNewShuttle("送機"));

    // 讓新增列的輸入欄位支援按 Enter 直接儲存
    document.querySelectorAll("#arrival-table-body .add-row input").forEach(input => {
        input.addEventListener("keypress", (e) => {
            if (e.key === "Enter") saveNewShuttle("接機");
        });
    });
    document.querySelectorAll("#departure-table-body .add-row input").forEach(input => {
        input.addEventListener("keypress", (e) => {
            if (e.key === "Enter") saveNewShuttle("送機");
        });
    });

    // 一鍵寄送接送機表
    document.getElementById("btn-send-email").addEventListener("click", sendShuttleEmail);

    // 接送機子頁籤切換
    const subTabButtons = document.querySelectorAll("#shuttle-sub-tabs .sub-tab-btn");
    subTabButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            subTabButtons.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");

            const targetTab = btn.dataset.subtab;
            if (targetTab === "shuttle-arrival") {
                document.getElementById("shuttle-arrival").classList.remove("hidden");
                document.getElementById("shuttle-departure").classList.add("hidden");
            } else {
                document.getElementById("shuttle-arrival").classList.add("hidden");
                document.getElementById("shuttle-departure").classList.add("hidden");
                document.getElementById("shuttle-departure").classList.remove("hidden");
            }
        });
    });

    // 7. 訂金表格內直接新增儲存 (Inline Add)
    document.getElementById("btn-save-fin").addEventListener("click", saveNewDeposit);
    
    // 讓新增列的輸入欄位支援按 Enter 直接儲存
    document.querySelectorAll("#deposit-table-body .add-row input").forEach(input => {
        input.addEventListener("keypress", (e) => {
            if (e.key === "Enter") saveNewDeposit();
        });
    });

    const filterButtons = document.querySelectorAll("#deposit-filters .filter-btn");
    filterButtons.forEach(btn => {
        btn.addEventListener("click", (e) => {
            filterButtons.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            state.currentDepositFilter = btn.dataset.filter;
            renderDeposits();
        });
    });

    // 8. 登入與登出事件
    document.getElementById("btn-submit-login").addEventListener("click", handleLoginSubmit);
    document.getElementById("login-password-input").addEventListener("keypress", (e) => {
        if (e.key === "Enter") handleLoginSubmit();
    });
    document.getElementById("btn-logout").addEventListener("click", handleLogout);

    // 9. 待辦篩選事件
    const todoFilterButtons = document.querySelectorAll("#todo-filters .filter-btn");
    todoFilterButtons.forEach(btn => {
        btn.addEventListener("click", (e) => {
            todoFilterButtons.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            state.currentTodoFilter = btn.dataset.filter;
            renderTodos();
        });
    });

    // 10. 新增例行項目事件
    document.getElementById("btn-add-routine").addEventListener("click", addRoutineTaskItem);
    document.getElementById("routine-add-input").addEventListener("keypress", (e) => {
        if (e.key === "Enter") addRoutineTaskItem();
    });
}

/**
 * 調整當前日期 (加減天數)
 */
function adjustDate(days) {
    const currentDate = new Date(state.targetDate);
    currentDate.setDate(currentDate.getDate() + days);
    state.targetDate = formatDateString(currentDate);
    document.getElementById("target-date").value = state.targetDate;
    renderAll();
}

// ==========================================================================
// 資料同步與 API 通訊
// ==========================================================================

/**
 * 從 GAS 後端或 LocalStorage 同步資料
 */
async function syncData(showOverlay = false, silent = false) {
    if (showOverlay) showLoading("與雲端試算表同步中...");

    // 檢查是否設定了有效的 GAS 網址
    const isMockMode = !CONFIG || CONFIG.GAS_URL.includes("xxxxxxxxxxxx");

    if (isMockMode) {
        // 離線展示模式：從 LocalStorage 讀取
        loadLocalData();
        state.isConnected = false;
        updateConnectionUI();
        if (showOverlay) {
            hideLoading();
            showToast("ℹ️ 目前處於離線展示模式（資料暫存在瀏覽器）");
        }
        renderAll();
        return;
    }

     // 2. 從 Google Apps Script API 獲取資料
    try {
        const savedPassword = localStorage.getItem("suguanjia_password") || "";
        const urlWithAuth = `${CONFIG.GAS_URL}?password=${encodeURIComponent(savedPassword)}`;
        const response = await fetch(urlWithAuth);
        if (!response.ok) throw new Error(`HTTP 錯誤，狀態碼：${response.status}`);

        const result = await response.json();
        if (result.status === "success") {
            const serverData = result.data;
            state.todos = serverData.todos || [];
            state.shuttle = serverData.shuttle || [];
            state.dailyChecklist = result.data.dailyChecklist || [];
            state.dailyTasks = result.data.dailyTasks || [];
            state.deposits = result.data.deposits || [];
            if (result.data.routineConfig && result.data.routineConfig.length > 0) {
                state.routineTasksList = result.data.routineConfig.map(r => r.項目名稱);
            }
            state.isConnected = true;

            // 同步備份到本地
            saveLocalData();
            if (!silent) showToast("✅ 雲端同步成功");
        } else {
            throw new Error(result.message);
        }
    } catch (err) {
        console.error("同步失敗，改用本地備份資料:", err);
        loadLocalData();
        state.isConnected = false;
        if (!silent) showToast("⚠️ 無法連線至雲端，已載入本地暫存資料");
    } finally {
        updateConnectionUI();
        hideLoading();
        renderAll();
    }
}

/**
 * 執行後端 POST 請求操作
 */
async function executeBackendAction(action, payload) {
    const isMockMode = !state.isConnected || !CONFIG || CONFIG.GAS_URL.includes("xxxxxxxxxxxx");

    // 本地先儲存以提供即時反應 (Optimistic Update)
    saveLocalData();

    if (isMockMode) {
        console.log(`[離線模式] 執行 ${action}:`, payload);
        return { status: "success" };
    }
    // 發送 POST 請求至後端
    try {
        const savedPassword = localStorage.getItem("suguanjia_password") || "";
        const response = await fetch(CONFIG.GAS_URL, {
            method: "POST",
            mode: "cors",
            headers: {
                "Content-Type": "text/plain" // 解決 GAS CORS 預檢請求限制
            },
            body: JSON.stringify({
                action: action,
                password: savedPassword, // 夾帶密碼進行後端驗證
                ...payload
            })
        });
        const result = await response.json();
        if (result.status !== "success") {
            throw new Error(result.message);
        }
        
        // 存檔成功後，自動在背景無感同步最新數據，確保公式/其他裝置變更即時更新
        syncData(false, true);
        
        return result;
    } catch (err) {
        console.error(`執行後端操作 ${action} 失敗:`, err);
        showToast("⚠️ 變更已存於本機，但未能成功同步至雲端試算表");
        return { status: "error", message: err.toString() };
    }
}

/**
 * 從 LocalStorage 載入資料
 */
function loadLocalData() {
    state.todos = JSON.parse(localStorage.getItem("mk_todos")) || [];
    state.shuttle = JSON.parse(localStorage.getItem("mk_shuttle")) || [];
    state.dailyChecklist = JSON.parse(localStorage.getItem("mk_dailyChecklist")) || [];
    state.dailyTasks = JSON.parse(localStorage.getItem("mk_dailyTasks")) || [];
    state.deposits = JSON.parse(localStorage.getItem("mk_deposits")) || [];
}

/**
 * 儲存資料至 LocalStorage
 */
function saveLocalData() {
    localStorage.setItem("mk_todos", JSON.stringify(state.todos));
    localStorage.setItem("mk_shuttle", JSON.stringify(state.shuttle));
    localStorage.setItem("mk_dailyChecklist", JSON.stringify(state.dailyChecklist));
    localStorage.setItem("mk_dailyTasks", JSON.stringify(state.dailyTasks));
    localStorage.setItem("mk_deposits", JSON.stringify(state.deposits));
}

/**
 * 更新連線狀態 UI 燈號
 */
function updateConnectionUI() {
    const indicator = document.getElementById("sync-indicator");
    const text = document.getElementById("status-text");

    if (state.isConnected) {
        indicator.className = "status-badge online";
        text.textContent = "已連線至試算表";
    } else {
        indicator.className = "status-badge offline";
        text.textContent = "離線展示模式";
    }
}

// ==========================================================================
// 渲染邏輯 (Renders)
// ==========================================================================

/**
 * 重新渲染整個頁面所有元件
 */
function renderAll() {
    renderTodos();
    renderRoomTable();
    renderRoutineTasks();
    renderShuttle();
    renderDeposits();
}

/**
 * 1. 渲染待辦清單
 */
function renderTodos() {
    const container = document.getElementById("todo-list-container");
    const countBadge = document.getElementById("todo-count");
    container.innerHTML = "";

    const activeTodos = state.todos;
    countBadge.textContent = `${activeTodos.filter(t => t.是否完成 !== "TRUE" && t.是否完成 !== true).length} 項待辦`;

    let filteredTodos = activeTodos;
    if (state.currentTodoFilter === "pending") {
        filteredTodos = activeTodos.filter(t => t.是否完成 !== "TRUE" && t.是否完成 !== true);
    } else if (state.currentTodoFilter === "completed") {
        filteredTodos = activeTodos.filter(t => t.是否完成 === "TRUE" || t.是否完成 === true);
    }

    if (filteredTodos.length === 0) {
        container.innerHTML = `<li class="empty-msg">沒有相符的待辦事項</li>`;
        return;
    }

    // 依建立時間排序，舊的在前、新的在後
    filteredTodos.sort((a, b) => new Date(a.建立時間) - new Date(b.建立時間));

    activeTodos.forEach(todo => {
        const li = document.createElement("li");
        const isCompleted = todo.是否完成 === "TRUE" || todo.是否完成 === true;
        li.className = `todo-item ${isCompleted ? 'completed' : ''}`;

        li.innerHTML = `
            <div class="todo-item-left">
                <input type="checkbox" class="todo-checkbox" ${isCompleted ? 'checked' : ''}>
                <span class="todo-item-text">${todo.內容}</span>
            </div>
            <button class="btn-delete-item" title="刪除">🗑️</button>
        `;

        // 點擊文字區塊切換完成狀態
        li.querySelector(".todo-item-left").addEventListener("click", (e) => {
            if (e.target.type !== "checkbox") {
                const chk = li.querySelector("input[type='checkbox']");
                chk.checked = !chk.checked;
                toggleTodoStatus(todo.ID, chk.checked);
            }
        });

        // 點擊 checkbox
        li.querySelector(".todo-checkbox").addEventListener("change", (e) => {
            toggleTodoStatus(todo.ID, e.target.checked);
        });

        // 點擊刪除按鈕
        li.querySelector(".btn-delete-item").addEventListener("click", () => {
            deleteTodoItem(todo.ID);
        });

        container.appendChild(li);
    });
}

/**
 * 2. 渲染每日檢點房況表 (改為固定四房且支援直接編輯)
 */
function renderRoomTable() {
    const tbody = document.getElementById("room-table-body");
    tbody.innerHTML = "";

    // 動態搜集並更新「未確認的送機旅客姓名」下拉選單
    const unconfirmedDepartures = (state.shuttle || []).filter(s => 
        s.類型 === "送機" && 
        (s.是否確認 !== "TRUE" && s.是否確認 !== true) &&
        s.姓名
    );
    const datalist = document.getElementById("departure-names-list");
    if (datalist) {
        datalist.innerHTML = unconfirmedDepartures.map(d => `
            <option value="${d.姓名}">${d.姓名} (房號: ${d.房號 || '未填'})</option>
        `).join("");
    }

    // 確保當前日期的 FIXED_ROOMS 都有資料，若無則在前端初始化預設值
    FIXED_ROOMS.forEach(roomNo => {
        let room = state.dailyChecklist.find(r => r.日期 === state.targetDate && r.房號 === roomNo);
        if (!room) {
            room = {
                ID: `room_${state.targetDate}_${roomNo}`,
                日期: state.targetDate,
                房號: roomNo,
                人數: "",
                明日早餐: "",
                時間: "",
                "清/不清": "不清",
                民宿送機: "",
                續退: "續",
                是否確認: "FALSE",
                備註: ""
            };
            state.dailyChecklist.push(room);
        }
    });

    // 依 FIXED_ROOMS 的固定順序渲染
    FIXED_ROOMS.forEach(roomNo => {
        const room = state.dailyChecklist.find(r => r.日期 === state.targetDate && r.房號 === roomNo);
        const tr = document.createElement("tr");
        const isChecked = room.是否確認 === "TRUE" || room.是否確認 === true;

        if (isChecked) {
            tr.style.opacity = "0.85";
            tr.style.backgroundColor = "rgba(92, 163, 130, 0.03)";
        }

        // 直接在 HTML 中內嵌無邊框輸入框與點擊切換事件
        tr.innerHTML = `
            <td style="font-weight: bold; color: var(--color-primary);">${room.房號}</td>
            <td>
                <input type="text" class="inline-input" style="width: 50px; text-align: center;" 
                    value="${room.人數 || ""}" placeholder="-" list="guest-options"
                    onchange="updateRoomField('${room.ID}', '人數', this.value)">
            </td>
            <td>
                <input type="text" class="inline-input" style="width: 120px;" 
                    value="${room.明日早餐 || ""}" placeholder="選擇或輸入..." list="breakfast-options"
                    onchange="updateRoomField('${room.ID}', '明日早餐', this.value)">
            </td>
            <td>
                <input type="text" class="inline-input" style="width: 80px; text-align: center;" 
                    value="${room.時間 || ""}" placeholder="07:00" list="time-options"
                    onchange="updateRoomField('${room.ID}', '時間', this.value)">
            </td>
            <td>
                <span class="tag-badge-btn ${room['清/不清'] === '清' ? 'tag-clean' : 'tag-dirty'}" 
                    onclick="toggleRoomBadge('${room.ID}', '清/不清')">
                    ${room['清/不清'] || "不清"}
                </span>
            </td>
            <td>
                <input type="text" class="inline-input" style="width: 100px;" 
                    value="${room.民宿送機 || ""}" placeholder="送機人..." list="departure-names-list"
                    onchange="updateRoomField('${room.ID}', '民宿送機', this.value)">
            </td>
            <td>
                <span class="tag-badge-btn ${room.續退 === '續' ? 'tag-status-extend' : 'tag-status-checkout'}" 
                    onclick="toggleRoomBadge('${room.ID}', '續退')">
                    ${room.續退 || "續"}
                </span>
            </td>
            <td style="text-align: center;">
                <input type="checkbox" class="todo-checkbox" ${isChecked ? 'checked' : ''} 
                    onchange="toggleRoomChecked('${room.ID}', this.checked)">
            </td>
            <td>
                <input type="text" class="inline-input" style="width: 100%; min-width: 150px;" 
                    value="${room.備註 || ""}" placeholder="備註..." 
                    onchange="updateRoomField('${room.ID}', '備註', this.value)">
            </td>
        `;

        tbody.appendChild(tr);
    });
}

/**
 * 3. 渲染每日例行任務核對清單 (支援勾選後自動下移)
 */
function renderRoutineTasks() {
    const container = document.getElementById("routine-list-container");
    if (!container) return;
    container.innerHTML = "";

    const todayTasks = state.dailyTasks.filter(t => t.日期 === state.targetDate);
    
    // 建立任務資料結構，包含名稱、原始索引與勾選狀態
    const taskObjects = state.routineTasksList.map((task, index) => {
        const taskState = todayTasks.find(t => t.任務名稱 === task);
        const isChecked = taskState && (taskState.是否完成 === "TRUE" || taskState.是否完成 === true);
        return {
            name: task,
            originalIndex: index,
            checked: isChecked
        };
    });

    // 排序邏輯：未完成在上方，已完成（勾選）在下方；同狀態下依原始順序排列
    taskObjects.sort((a, b) => {
        if (a.checked !== b.checked) {
            return a.checked ? 1 : -1;
        }
        return a.originalIndex - b.originalIndex;
    });

    let checkedCount = 0;

    taskObjects.forEach((taskObj) => {
        const div = document.createElement("div");
        div.className = `routine-item ${taskObj.checked ? 'checked' : ''}`;
        div.innerHTML = `
            <input type="checkbox" class="todo-checkbox" id="chk-routine-${taskObj.originalIndex}" ${taskObj.checked ? 'checked' : ''}>
            <span>${taskObj.name}</span>
        `;
        
        if (taskObj.checked) {
            checkedCount++;
        }

        // 點擊卡片任意地方皆可觸發勾選
        div.addEventListener("click", (e) => {
            if (e.target.type !== "checkbox") {
                const chk = div.querySelector("input[type='checkbox']");
                if (chk) {
                    chk.checked = !chk.checked;
                    toggleRoutineTask(taskObj.name, chk.checked);
                }
            }
        });
        
        const chkInput = div.querySelector("input[type='checkbox']");
        if (chkInput) {
            chkInput.addEventListener("change", (e) => {
                toggleRoutineTask(taskObj.name, e.target.checked);
            });
        }

        container.appendChild(div);
    });

    // 更新進度條
    const progressPercent = state.routineTasksList.length > 0 ? Math.round((checkedCount / state.routineTasksList.length) * 100) : 0;
    document.getElementById("routine-progress").textContent = `${progressPercent}%`;
    document.getElementById("routine-progress-bar").style.width = `${progressPercent}%`;
}

/**
 * 4. 渲染接送機時刻表 (全期顯示，支援直接編輯與勾選下移)
 */
function renderShuttle() {
    const arrivalTbody = document.getElementById("arrival-table-body");
    const departureTbody = document.getElementById("departure-table-body");

    // 找出第一行 add-row，並清除後面的動態資料行
    const arrAddRow = arrivalTbody.querySelector(".add-row");
    const depAddRow = departureTbody.querySelector(".add-row");

    arrivalTbody.innerHTML = "";
    departureTbody.innerHTML = "";

    if (arrAddRow) arrivalTbody.appendChild(arrAddRow);
    if (depAddRow) departureTbody.appendChild(depAddRow);

    const allShuttles = state.shuttle || [];
    const arrivals = allShuttles.filter(s => s.類型 === "接機");
    const departures = allShuttles.filter(s => s.類型 === "送機");

    document.getElementById("arrival-count").textContent = `${arrivals.length} 筆`;
    document.getElementById("departure-count").textContent = `${departures.length} 筆`;

    // 排序邏輯：未確認在上方（日期越早越前/升序，同日依時間升序），已確認在下方（日期越晚越前/降序）
    const sortShuttles = (list) => {
        return list.sort((a, b) => {
            const aChecked = a.是否確認 === "TRUE" || a.是否確認 === true;
            const bChecked = b.是否確認 === "TRUE" || b.是否確認 === true;

            if (aChecked !== bChecked) {
                return aChecked ? 1 : -1; // 未確認排前面
            }

            // 如果都是未確認：日期越早排前面 (升序)
            if (!aChecked) {
                if (a.日期 !== b.日期) {
                    return String(a.日期).localeCompare(String(b.日期));
                }
                return String(a.送機時間).localeCompare(String(b.送機時間));
            }

            // 如果都是已確認：日期越晚排前面 (降序)
            if (a.日期 !== b.日期) {
                return String(b.日期).localeCompare(String(a.日期));
            }
            return String(a.送機時間).localeCompare(String(b.送機時間));
        });
    };

    const sortedArrivals = sortShuttles(arrivals);
    const sortedDepartures = sortShuttles(departures);

    // --- 渲染接機 ---
    if (sortedArrivals.length === 0) {
        const emptyTr = document.createElement("tr");
        emptyTr.className = "empty-row-msg";
        emptyTr.innerHTML = `<td colspan="13" class="empty-msg">暫無接機行程</td>`;
        arrivalTbody.appendChild(emptyTr);
    } else {
        sortedArrivals.forEach(row => {
            const tr = document.createElement("tr");
            const isChecked = row.是否確認 === "TRUE" || row.是否確認 === true;

            if (isChecked) {
                tr.className = "shuttle-row-completed";
            }

            tr.innerHTML = `
                <td style="text-align: center;">
                    <input type="checkbox" class="todo-checkbox" ${isChecked ? 'checked' : ''} 
                        onchange="toggleShuttleChecked('${row.ID}', this.checked)">
                </td>
                <td>
                    <input type="number" class="inline-input" style="width: 45px; text-align: center;" 
                        value="${row.入住天數 || ""}" placeholder="-" min="1"
                        onchange="updateShuttleField('${row.ID}', '入住天數', this.value)">
                </td>
                <td>
                    <input type="text" class="inline-input" style="width: 60px; text-align: center; font-weight: 500;" 
                        value="${formatDisplayDate(row.日期)}" placeholder="6/30" 
                        onchange="updateShuttleField('${row.ID}', '日期', this.value)">
                </td>
                <td style="text-align: center; color: var(--text-muted); font-size: 13px;">民宿</td>
                <td>
                    <input type="text" class="inline-input" style="width: 80px;" 
                        value="${row.姓名 || ""}" placeholder="姓名" 
                        onchange="updateShuttleField('${row.ID}', '姓名', this.value)">
                </td>
                <td>
                    <input type="text" class="inline-input" style="width: 110px;" 
                        value="${row.電話 || ""}" placeholder="電話" 
                        onchange="updateShuttleField('${row.ID}', '電話', this.value)">
                </td>
                <td>
                    <input type="text" class="inline-input" style="width: 85px;" 
                        value="${row['班次/航班'] || ""}" placeholder="航班" 
                        onchange="updateShuttleField('${row.ID}', '班次/航班', this.value)">
                </td>
                <td>
                    <input type="text" class="inline-input" style="width: 60px; text-align: center;" 
                        value="${row.起飛時間 || ""}" placeholder="起飛" 
                        onchange="updateShuttleField('${row.ID}', '起飛時間', this.value)">
                </td>
                <td>
                    <input type="text" class="inline-input" style="width: 60px; text-align: center; font-weight: bold; color: var(--color-accent);" 
                        value="${row.送機時間 || ""}" placeholder="到達" 
                        onchange="updateShuttleField('${row.ID}', '送機時間', this.value)">
                </td>
                <td>
                    <input type="number" class="inline-input" style="width: 45px; text-align: center;" 
                        value="${row.人數 || ""}" placeholder="-" 
                        onchange="updateShuttleField('${row.ID}', '人數', this.value)">
                </td>
                <td>
                    <input type="text" class="inline-input" style="width: 80px;" 
                        value="${row.司機 || ""}" placeholder="司機" 
                        onchange="updateShuttleField('${row.ID}', '司機', this.value)">
                </td>
                <td>
                    <input type="text" class="inline-input" style="width: 100%; min-width: 100px;" 
                        value="${row.備註 || ""}" placeholder="備註..." 
                        onchange="updateShuttleField('${row.ID}', '備註', this.value)">
                </td>
                <td style="text-align: center;">
                    <button class="btn-text-action btn-sm" style="color: var(--color-accent);" onclick="deleteShuttleItem('${row.ID}')">🗑️</button>
                </td>
            `;
            arrivalTbody.appendChild(tr);
        });
    }

    // --- 渲染送機 ---
    if (sortedDepartures.length === 0) {
        const emptyTr = document.createElement("tr");
        emptyTr.className = "empty-row-msg";
        emptyTr.innerHTML = `<td colspan="12" class="empty-msg">暫無送機行程</td>`;
        departureTbody.appendChild(emptyTr);
    } else {
        sortedDepartures.forEach(row => {
            const tr = document.createElement("tr");
            const isChecked = row.是否確認 === "TRUE" || row.是否確認 === true;

            if (isChecked) {
                tr.className = "shuttle-row-completed";
            }

            tr.innerHTML = `
                <td style="text-align: center;">
                    <input type="checkbox" class="todo-checkbox" ${isChecked ? 'checked' : ''} 
                        onchange="toggleShuttleChecked('${row.ID}', this.checked)">
                </td>
                <td>
                    <input type="text" class="inline-input" style="width: 60px; text-align: center; font-weight: 500;" 
                        value="${formatDisplayDate(row.日期)}" placeholder="6/30" 
                        onchange="updateShuttleField('${row.ID}', '日期', this.value)">
                </td>
                <td style="text-align: center; color: var(--text-muted); font-size: 13px;">民宿</td>
                <td>
                    <input type="text" class="inline-input" style="width: 50px; text-align: center;" 
                        value="${row.房號 || ""}" placeholder="房號" 
                        onchange="updateShuttleField('${row.ID}', '房號', this.value)">
                </td>
                <td>
                    <input type="text" class="inline-input" style="width: 80px;" 
                        value="${row.姓名 || ""}" placeholder="姓名" 
                        onchange="updateShuttleField('${row.ID}', '姓名', this.value)">
                </td>
                <td>
                    <input type="text" class="inline-input" style="width: 110px;" 
                        value="${row.電話 || ""}" placeholder="電話" 
                        onchange="updateShuttleField('${row.ID}', '電話', this.value)">
                </td>
                <td>
                    <input type="text" class="inline-input" style="width: 60px; text-align: center;" 
                        value="${row.起飛時間 || ""}" placeholder="起飛" 
                        onchange="updateShuttleField('${row.ID}', '起飛時間', this.value)">
                </td>
                <td>
                    <input type="text" class="inline-input" style="width: 60px; text-align: center; font-weight: bold; color: var(--color-accent);" 
                        value="${row.送機時間 || ""}" placeholder="送機" 
                        onchange="updateShuttleField('${row.ID}', '送機時間', this.value)">
                </td>
                <td>
                    <input type="number" class="inline-input" style="width: 45px; text-align: center;" 
                        value="${row.人數 || ""}" placeholder="-" 
                        onchange="updateShuttleField('${row.ID}', '人數', this.value)">
                </td>
                <td>
                    <input type="text" class="inline-input" style="width: 80px;" 
                        value="${row.司機 || ""}" placeholder="司機" 
                        onchange="updateShuttleField('${row.ID}', '司機', this.value)">
                </td>
                <td>
                    <input type="text" class="inline-input" style="width: 100%; min-width: 100px;" 
                        value="${row.備註 || ""}" placeholder="備註..." 
                        onchange="updateShuttleField('${row.ID}', '備註', this.value)">
                </td>
                <td style="text-align: center;">
                    <button class="btn-text-action btn-sm" style="color: var(--color-accent);" onclick="deleteShuttleItem('${row.ID}')">🗑️</button>
                </td>
            `;
            departureTbody.appendChild(tr);
        });
    }
}

/**
 * 5. 渲染訂金表 (支援直接編輯、點擊切換訂/尾、勾選作帳下移)
 */
function renderDeposits() {
    const tbody = document.getElementById("deposit-table-body");

    // 找出第一行 add-row，並清除後面的動態資料行
    const addRow = tbody.querySelector(".add-row");
    tbody.innerHTML = "";
    if (addRow) tbody.appendChild(addRow);

    let list = state.deposits || [];

    // 進行狀態篩選
    if (state.currentDepositFilter === '待作帳') {
        list = list.filter(d => d.狀態 !== '已作帳');
    } else if (state.currentDepositFilter === '已作帳') {
        list = list.filter(d => d.狀態 === '已作帳');
    }

    if (list.length === 0) {
        const emptyTr = document.createElement("tr");
        emptyTr.className = "empty-row-msg";
        emptyTr.innerHTML = `<td colspan="9" class="empty-msg">無符合篩選條件的訂金紀錄</td>`;
        tbody.appendChild(emptyTr);
        return;
    }

    // 排序邏輯：未作帳在上方（依入住日升序，同日依訂編升序），已作帳在下方（依入住日降序）
    list.sort((a, b) => {
        const aChecked = a.狀態 === "已作帳";
        const bChecked = b.狀態 === "已作帳";

        if (aChecked !== bChecked) {
            return aChecked ? 1 : -1; // 未作帳排前面
        }

        // 如果都是未作帳：依入住日升序 (日期越早排前面)
        if (!aChecked) {
            if (a.入住日 !== b.入住日) {
                return String(a.入住日 || '').localeCompare(String(b.入住日 || ''));
            }
            return String(a.訂編 || '').localeCompare(String(b.訂編 || ''));
        }

        // 如果都是已作帳：依入住日降序 (日期越新排前面)
        if (a.入住日 !== b.入住日) {
            return String(b.入住日 || '').localeCompare(String(a.入住日 || ''));
        }
        return String(b.訂編 || '').localeCompare(String(a.訂編 || ''));
    });

    list.forEach(row => {
        const tr = document.createElement("tr");
        const isChecked = row.狀態 === "已作帳";

        if (isChecked) {
            tr.className = "shuttle-row-completed";
        }

        tr.innerHTML = `
            <td style="text-align: center;">
                <input type="checkbox" class="todo-checkbox" ${isChecked ? 'checked' : ''} 
                    onchange="toggleDepositChecked('${row.訂編}', this.checked)">
            </td>
            <td>
                <input type="text" class="inline-input" style="width: 80px; text-align: center; font-weight: bold;" 
                    value="${row.訂編 || ""}" readonly title="訂單編號不可修改">
            </td>
            <td>
                <input type="text" class="inline-input" style="width: 90px;" 
                    value="${row.匯款日期 || ""}" placeholder="12/09" 
                    onchange="updateDepositField('${row.訂編}', '匯款日期', this.value)">
            </td>
            <td>
                <input type="text" class="inline-input" style="width: 90px; font-weight: 600; color: var(--color-primary);" 
                    value="${row.入住日 || ""}" placeholder="10/31" 
                    onchange="updateDepositField('${row.訂編}', '入住日', this.value)">
            </td>
            <td>
                <input type="text" class="inline-input" style="width: 100px;" 
                    value="${row.姓名 || ""}" placeholder="姓名" 
                    onchange="updateDepositField('${row.訂編}', '姓名', this.value)">
            </td>
            <td>
                <input type="number" class="inline-input" style="width: 90px; font-weight: bold; color: var(--color-primary);" 
                    value="${row.金額 || ""}" placeholder="金額" 
                    onchange="updateDepositField('${row.訂編}', '金額', this.value)">
            </td>
            <td style="text-align: center;">
                <button class="${row['訂/尾'] === '尾' ? 'tag-deposit-type-bal' : 'tag-deposit-type-dep'} tag-badge-btn" 
                    onclick="toggleDepositType('${row.訂編}')" style="border: none; cursor: pointer; padding: 4px 8px; font-size: 12px; border-radius: 4px;">
                    ${row['訂/尾'] || "訂"}
                </button>
            </td>
            <td>
                <input type="text" class="inline-input" style="width: 100%; min-width: 80px; font-family: monospace;" 
                    value="${row.匯編 || ""}" placeholder="後五碼" 
                    onchange="updateDepositField('${row.訂編}', '匯編', this.value)">
            </td>
            <td style="text-align: center;">
                <button class="btn-text-action btn-sm" style="color: var(--color-accent);" onclick="deleteDepositItem('${row.訂編}')">🗑️</button>
            </td>
        `;

        tbody.appendChild(tr);
    });
}

// ==========================================================================
// 資料新增、修改、刪除動作 (CRUD Logic)
// ==========================================================================

/**
 * 待辦清單：新增項目
 */
function addNewTodo() {
    const textInput = document.getElementById("new-todo-text");
    const text = textInput.value.trim();
    if (!text) return;

    const newTodo = {
        ID: "todo_" + Date.now(),
        內容: text,
        是否完成: "FALSE",
        建立時間: new Date().toISOString()
    };

    state.todos.push(newTodo);
    textInput.value = "";
    renderTodos();

    executeBackendAction("saveTodo", { data: newTodo });
}

/**
 * 待辦清單：切換完成狀態
 */
function toggleTodoStatus(id, isChecked) {
    const todo = state.todos.find(t => t.ID === id);
    if (todo) {
        todo.是否完成 = isChecked ? "TRUE" : "FALSE";
        renderTodos();
        executeBackendAction("saveTodo", { data: todo });
    }
}

/**
 * 待辦清單：刪除項目
 */
function deleteTodoItem(id) {
    state.todos = state.todos.filter(t => t.ID !== id);
    renderTodos();
    executeBackendAction("deleteTodo", { id: id });
}

/**
 * 房況檢點：開啟新增/編輯視窗
 */
/**
 * 房況檢點：直接修改欄位值並與雲端同步 (Optimistic Update)
 */
window.updateRoomField = function (id, field, value) {
    const room = state.dailyChecklist.find(r => r.ID === id);
    if (room) {
        room[field] = value.trim();
        saveLocalData();
        executeBackendAction("saveDailyCheck", { data: room });
    }
};

/**
 * 房況檢點：點擊徽章直接切換狀態並同步
 */
window.toggleRoomBadge = function (id, field) {
    const room = state.dailyChecklist.find(r => r.ID === id);
    if (room) {
        if (field === '清/不清') {
            room['清/不清'] = room['清/不清'] === '清' ? '不清' : '清';
        } else if (field === '續退') {
            room['續退'] = room['續退'] === '續' ? '退' : '續';
        }
        renderRoomTable();
        saveLocalData();
        executeBackendAction("saveDailyCheck", { data: room });
    }
};

/**
 * 房況檢點：切換房況確認勾選
 */
window.toggleRoomChecked = function (id, isChecked) {
    const room = state.dailyChecklist.find(r => r.ID === id);
    if (room) {
        room.是否確認 = isChecked ? "TRUE" : "FALSE";
        renderRoomTable();
        saveLocalData();
        executeBackendAction("saveDailyCheck", { data: room });
    }
};

/**
 * 每日例行任務：切換勾選狀態
 */
function toggleRoutineTask(taskName, isChecked) {
    // 尋找現有紀錄
    let taskState = state.dailyTasks.find(t => t.日期 === state.targetDate && t.任務名稱 === taskName);

    if (taskState) {
        taskState.是否完成 = isChecked ? "TRUE" : "FALSE";
    } else {
        taskState = {
            日期: state.targetDate,
            任務名稱: taskName,
            是否完成: isChecked ? "TRUE" : "FALSE"
        };
        state.dailyTasks.push(taskState);
    }

    renderRoutineTasks();
    executeBackendAction("saveDailyTask", { data: taskState });
}

/**
 * 接送機表：開啟新增/編輯視窗
 */
function openShuttleModal(shuttleData = null) {
    const modal = document.getElementById("shuttle-modal");
    const title = document.getElementById("shuttle-modal-title");
    const typeSelect = document.getElementById("shuttle-type");

    if (shuttleData) {
        title.textContent = `🚗 編輯${shuttleData.類型}行程`;
        document.getElementById("shuttle-id").value = shuttleData.ID;
        typeSelect.value = shuttleData.類型;
        document.getElementById("shuttle-hotel").value = shuttleData.飯店 || "";
        document.getElementById("shuttle-room").value = shuttleData.房號 || "";
        document.getElementById("shuttle-name").value = shuttleData.姓名 || "";
        document.getElementById("shuttle-phone").value = shuttleData.電話 || "";
        document.getElementById("shuttle-flight").value = shuttleData['班次/航班'] || "";
        document.getElementById("shuttle-dep-time").value = shuttleData.起飛時間 || "";
        document.getElementById("shuttle-arr-time").value = shuttleData.送機時間 || ""; // 注意：送機時間欄位後端為「送機時間」，對應到達/送機
        document.getElementById("shuttle-guests").value = shuttleData.人數 || "";
        document.getElementById("shuttle-driver").value = shuttleData.司機 || "";
        document.getElementById("shuttle-remarks").value = shuttleData.備註 || "";
    } else {
        title.textContent = "🚗 新增接送行程";
        document.getElementById("shuttle-id").value = "";
        document.getElementById("shuttle-form").reset();
    }

    // 觸發一次類型切換以設定房號欄位顯示
    typeSelect.dispatchEvent(new Event("change"));
    modal.classList.remove("hidden");
}

/**
 * 接送機表：首行直接新增邏輯
 */
window.saveNewShuttle = function (type) {
    let prefix = type === "接機" ? "arr" : "dep";

    const dateInput = document.getElementById(`add-${prefix}-date`);
    const nameInput = document.getElementById(`add-${prefix}-name`);
    const phoneInput = document.getElementById(`add-${prefix}-phone`);
    const flightInput = document.getElementById(`add-${prefix}-flight`);
    const depTimeInput = document.getElementById(`add-${prefix}-deptime`);
    const arrTimeInput = document.getElementById(`add-${prefix}-arrtime`);
    const guestsInput = document.getElementById(`add-${prefix}-guests`);
    const driverInput = document.getElementById(`add-${prefix}-driver`);
    const remarksInput = document.getElementById(`add-${prefix}-remarks`);

    // 只有接機有入住天數欄位
    const daysInput = type === "接機" ? document.getElementById("add-arr-days") : null;
    const daysVal = daysInput ? daysInput.value.trim() : "";

    // 房號欄位僅送機有
    const roomInput = type === "送機" ? document.getElementById("add-dep-room") : null;

    const dateVal = dateInput.value.trim();
    const nameVal = nameInput.value.trim();
    const guestsVal = guestsInput.value.trim();

    if (!dateVal || !nameVal) {
        showToast("⚠️ 請填寫日期與姓名！");
        return;
    }

    const parsedDate = parseInputDate(dateVal);
    const newId = "shuttle_" + Date.now();

    const newShuttle = {
        ID: newId,
        類型: type,
        日期: parsedDate,
        飯店: "民宿", // 固定填入民宿
        房號: roomInput ? roomInput.value.trim() : "",
        姓名: nameVal,
        電話: phoneInput.value.trim(),
        起飛時間: depTimeInput.value.trim(),
        送機時間: arrTimeInput.value.trim(), // 對應到達時間或送機時間
        '班次/航班': flightInput ? flightInput.value.trim() : "",
        人數: guestsVal || "1",
        司機: driverInput.value.trim(),
        備註: remarksInput.value.trim(),
        是否確認: "FALSE",
        入住天數: type === "接機" ? daysVal : ""
    };

    state.shuttle.push(newShuttle);

    let promises = [executeBackendAction("saveShuttle", { data: newShuttle })];

    // 自動連動邏輯：如果是接機且填寫了入住天數，自動生成一筆送機日程
    const stayDays = parseInt(daysVal, 10);
    if (type === "接機" && !isNaN(stayDays) && stayDays > 0) {
        // 安全地計算送機日期，避免時區偏離
        const parts = parsedDate.split('-');
        const year = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1;
        const day = parseInt(parts[2], 10);
        const depDateObj = new Date(year, month, day + stayDays);

        const depYear = depDateObj.getFullYear();
        const depMonth = String(depDateObj.getMonth() + 1).padStart(2, '0');
        const depDay = String(depDateObj.getDate()).padStart(2, '0');
        const departureDate = `${depYear}-${depMonth}-${depDay}`;

        const depId = "shuttle_" + (Date.now() + 1);
        const correspondingDeparture = {
            ID: depId,
            類型: "送機",
            日期: departureDate,
            飯店: "民宿",
            房號: "",
            姓名: nameVal,
            電話: phoneInput.value.trim(),
            起飛時間: "",
            送機時間: "",
            '班次/航班': "",
            人數: guestsVal || "1",
            司機: "",
            備註: "", // 備註保持空白
            是否確認: "FALSE",
            入住天數: ""
        };

        state.shuttle.push(correspondingDeparture);
        promises.push(executeBackendAction("saveShuttle", { data: correspondingDeparture }));
    }

    // 清空輸入列
    dateInput.value = "";
    nameInput.value = "";
    phoneInput.value = "";
    if (flightInput) flightInput.value = "";
    depTimeInput.value = "";
    arrTimeInput.value = "";
    guestsInput.value = "";
    driverInput.value = "";
    remarksInput.value = "";
    if (roomInput) roomInput.value = "";
    if (daysInput) daysInput.value = "";

    renderShuttle();
    saveLocalData();

    Promise.all(promises).then(() => {
        showToast(`✅ 已新增${type}：${newShuttle.姓名}`);
    });
};

/**
 * 接送機表：勾選確認切換並儲存 (勾選會往下排)
 */
window.toggleShuttleChecked = function (id, isChecked) {
    const item = state.shuttle.find(s => s.ID === id);
    if (item) {
        item.是否確認 = isChecked ? "TRUE" : "FALSE";
        renderShuttle();
        saveLocalData();
        executeBackendAction("saveShuttle", { data: item });
    }
};

/**
 * 接送機表：欄位值直接編輯並同步
 */
window.updateShuttleField = function (id, field, value) {
    const item = state.shuttle.find(s => s.ID === id);
    if (item) {
        let val = value.trim();
        if (field === '日期') {
            val = parseInputDate(val);
        }
        item[field] = val;
        saveLocalData();
        executeBackendAction("saveShuttle", { data: item });

        // 修改了日期或時間，需要重新排序渲染
        if (field === '日期' || field === '送機時間') {
            renderShuttle();
        }
    }
};

/**
 * 接送機表：刪除項目
 */
function deleteShuttleItem(id) {
    if (confirm("確定要刪除此筆接送機行程嗎？")) {
        state.shuttle = state.shuttle.filter(s => s.ID !== id);
        renderShuttle();
        executeBackendAction("deleteShuttle", { id: id }).then(() => {
            showToast("已刪除接送行程");
        });
    }
}

/**
 * 訂金表：首行直接新增邏輯
 */
window.saveNewDeposit = function () {
    const idInput = document.getElementById("add-fin-id");
    const remitDateInput = document.getElementById("add-fin-remitdate");
    const checkinDateInput = document.getElementById("add-fin-checkindate");
    const nameInput = document.getElementById("add-fin-name");
    const amountInput = document.getElementById("add-fin-amount");
    const typeSelect = document.getElementById("add-fin-type");
    const codeInput = document.getElementById("add-fin-code");

    const idVal = idInput.value.trim();
    const nameVal = nameInput.value.trim();
    const amountVal = amountInput.value.trim();

    if (!idVal || !nameVal || !amountVal) {
        showToast("⚠️ 請填寫訂編、姓名與金額！");
        return;
    }

    // 檢查訂編是否已存在
    if (state.deposits.some(d => String(d.訂編) === idVal)) {
        showToast("⚠️ 此訂單編號已存在！");
        return;
    }

    const newDeposit = {
        訂編: idVal,
        匯款日期: remitDateInput.value.trim(),
        入住日: checkinDateInput.value.trim(),
        姓名: nameVal,
        金額: amountVal,
        '訂/尾': typeSelect.value,
        匯編: codeInput.value.trim(),
        狀態: "待處理" // 預設未作帳
    };

    state.deposits.push(newDeposit);

    // 清空輸入列
    idInput.value = "";
    remitDateInput.value = "";
    checkinDateInput.value = "";
    nameInput.value = "";
    amountInput.value = "";
    codeInput.value = "";

    renderDeposits();
    saveLocalData();

    executeBackendAction("saveDeposit", { data: newDeposit }).then(() => {
        showToast(`✅ 已新增訂金紀錄：#${newDeposit.訂編}`);
    });
};

/**
 * 訂金表：作帳狀態勾選切換 (勾選會往下排)
 */
window.toggleDepositChecked = function (id, isChecked) {
    const item = state.deposits.find(d => d.訂編 === id);
    if (item) {
        item.狀態 = isChecked ? "已作帳" : "待處理";
        renderDeposits();
        saveLocalData();
        executeBackendAction("saveDeposit", { data: item });
    }
};

/**
 * 訂金表：點擊切換訂/尾狀態
 */
window.toggleDepositType = function (id) {
    const item = state.deposits.find(d => d.訂編 === id);
    if (item) {
        item['訂/尾'] = item['訂/尾'] === '尾' ? '訂' : '尾';
        renderDeposits();
        saveLocalData();
        executeBackendAction("saveDeposit", { data: item });
    }
};

/**
 * 訂金表：欄位值直接編輯與同步
 */
window.updateDepositField = function (id, field, value) {
    const item = state.deposits.find(d => d.訂編 === id);
    if (item) {
        item[field] = value.trim();
        saveLocalData();
        executeBackendAction("saveDeposit", { data: item });

        // 如果修改了影響排序的「入住日」，重新排序渲染
        if (field === '入住日') {
            renderDeposits();
        }
    }
};

/**
 * 訂金表：刪除紀錄
 */
function deleteDepositItem(id) {
    if (confirm(`確定要刪除訂單編號為 #${id} 的訂金紀錄嗎？`)) {
        state.deposits = state.deposits.filter(d => d.訂編 !== id);
        renderDeposits();
        executeBackendAction("deleteDeposit", { id: id }).then(() => {
            showToast(`已刪除訂金紀錄 #${id}`);
        });
    }
}

/**
 * 一鍵發送接送機日課表郵件 (自動計算並寄送明日日程)
 */
async function sendShuttleEmail() {
    const email = document.getElementById("shuttle-email").value.trim();
    if (!email) {
        showToast("⚠️ 請輸入有效的收件電子信箱！");
        return;
    }

    // 自動計算明天的日期 (今天日期 + 1天)
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = formatDateString(tomorrow);

    if (!confirm(`確定要將明日（${tomorrowStr}）的接送機日程表寄送至 ${email} 嗎？`)) {
        return;
    }

    showLoading(`正在發送明日（${tomorrowStr}）的接送機表至 ${email}...`);

    const res = await executeBackendAction("sendShuttleEmail", {
        date: tomorrowStr,
        email: email
    });

    hideLoading();

    if (res.status === "success") {
        alert(`🎉 明日（${tomorrowStr}）的接送行程表已成功寄送至：\n${email}\n\n請檢查該信箱收件夾！`);
        showToast("✉️ 郵件寄送成功！");
    } else {
        alert(`❌ 寄送失敗：\n${res.message || "未知原因"}\n\n請確認您的 GAS 部署與網路連線。`);
        showToast("❌ 郵件寄送失敗");
    }
}

// ==========================================================================
// UI 輔助控制
// ==========================================================================

function closeModal(modalId) {
    document.getElementById(modalId).classList.add("hidden");
}

function showToast(msg) {
    const toast = document.getElementById("toast");
    toast.textContent = msg;
    toast.classList.remove("hidden");

    // 3秒後淡出
    setTimeout(() => {
        toast.classList.add("hidden");
    }, 3000);
}

function showLoading(text = "連線中...") {
    document.getElementById("loading-text").textContent = text;
    document.getElementById("loading-overlay").classList.remove("hidden");
}

function hideLoading() {
    document.getElementById("loading-overlay").classList.add("hidden");
}

// ==========================================================================
// 登入驗證與鎖定控制 (Security Auth Logic)
// ==========================================================================

/**
 * 檢查登入狀態與顯示遮罩
 */
function checkLoginState() {
    const savedPassword = localStorage.getItem("suguanjia_password");
    const loginOverlay = document.getElementById("login-overlay");
    
    if (savedPassword === CONFIG.LOGIN_PASSWORD) {
        // 已登入：隱藏登入遮罩，並首次同步資料
        loginOverlay.classList.add("hidden");
        syncData();
    } else {
        // 未登入：顯示登入遮罩，不進行任何 API 呼叫
        loginOverlay.classList.remove("hidden");
        
        // 聚焦在密碼輸入框
        setTimeout(() => {
            const pwdInput = document.getElementById("login-password-input");
            if (pwdInput) pwdInput.focus();
        }, 150);
    }
}

/**
 * 處理登入確認
 */
function handleLoginSubmit() {
    const passwordInput = document.getElementById("login-password-input");
    const errorMsg = document.getElementById("login-error-msg");
    const enteredPassword = passwordInput.value.trim();
    
    if (enteredPassword === CONFIG.LOGIN_PASSWORD) {
        // 密碼正確：儲存至本地並隱藏遮罩
        localStorage.setItem("suguanjia_password", enteredPassword);
        errorMsg.classList.add("hidden");
        passwordInput.value = "";
        checkLoginState();
    } else {
        // 密碼錯誤
        errorMsg.classList.remove("hidden");
        passwordInput.value = "";
        passwordInput.focus();
    }
}

/**
 * 處理登出
 */
function handleLogout() {
    if (confirm("確定要登出系統並鎖定網頁嗎？")) {
        localStorage.removeItem("suguanjia_password");
        location.reload(); // 重整網頁會直接進入登入畫面
    }
}

/**
 * 每日例行項目：新增項目並同步到 GAS
 */
async function addRoutineTaskItem() {
    const input = document.getElementById("routine-add-input");
    if (!input) return;
    const name = input.value.trim();
    if (!name) return;

    if (state.routineTasksList.includes(name)) {
        showToast("⚠️ 項目已存在！");
        return;
    }

    // 本地先更新 (Optimistic Update)
    state.routineTasksList.push(name);
    renderRoutineTasks();
    input.value = "";

    showLoading("正在新增例行項目...");
    try {
        const result = await executeBackendAction("saveRoutineConfigItem", { name: name });
        if (result.status === "success") {
            showToast("✅ 新增例行項目成功");
        } else {
            throw new Error(result.message);
        }
    } catch (err) {
        showToast(`❌ 新增失敗: ${err.message}`);
        // 失敗復原
        state.routineTasksList = state.routineTasksList.filter(item => item !== name);
        renderRoutineTasks();
    } finally {
        hideLoading();
    }
}
