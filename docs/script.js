// Replace with your Google Apps Script URL
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbw2SuSAAXthVLpEb2Av-f1kJAAISWiE6klnzfHJE1KAW9R5Hjo2IUArQK4wPGovMlk/exec';

// Global variables
let customDuties = {};

document.addEventListener('DOMContentLoaded', function() {
    // Initialize UI
    initDoctors();
    initLeaveDates();
    loadSchedule();
    loadDistribution();

    // Event listeners
    document.getElementById('addDoctor').addEventListener('click', addDoctorInput);
    document.getElementById('saveDoctors').addEventListener('click', saveDoctors);
    document.getElementById('addLeave').addEventListener('click', addLeaveDate);
    document.getElementById('clearLeaves').addEventListener('click', clearLeaveDates);
    document.getElementById('addCustomDuty').addEventListener('click', addCustomDuty);
    document.getElementById('generate').addEventListener('click', generateSchedule);
    document.getElementById('clearSchedule').addEventListener('click', clearSchedule);
});

// Initialize doctors list
async function initDoctors() {
    const doctors = await getData('Doctors');
    const doctorsList = document.getElementById('doctorsList');
    const leaveDoctorSelect = document.getElementById('leaveDoctor');
    
    doctorsList.innerHTML = '';
    leaveDoctorSelect.innerHTML = '<option value="">Select Doctor</option>';
    
    if (doctors && doctors.length > 0) {
        doctors.forEach(doctor => {
            if (doctor[0]) {
                addDoctorInput(doctor[0]);
                leaveDoctorSelect.innerHTML += `<option value="${doctor[0]}">${doctor[0]}</option>`;
            }
        });
    } else {
        addDoctorInput();
    }
}

// Add a doctor input field
function addDoctorInput(value = '') {
    const doctorsList = document.getElementById('doctorsList');
    const div = document.createElement('div');
    div.className = 'doctor-input input-group mb-2';
    div.innerHTML = `
        <input type="text" class="form-control doctor-name" value="${value}" placeholder="Doctor name">
        <button class="btn btn-outline-danger remove-doctor" type="button">×</button>
    `;
    doctorsList.appendChild(div);
    
    div.querySelector('.remove-doctor').addEventListener('click', function() {
        doctorsList.removeChild(div);
    });
}

// Save doctors to Google Sheet
async function saveDoctors() {
    const doctorInputs = document.querySelectorAll('.doctor-name');
    const doctors = Array.from(doctorInputs).map(input => [input.value.trim()]).filter(d => d[0]);
    
    if (doctors.length === 0) {
        alert('Please add at least one doctor');
        return;
    }
    
    await postData('Doctors', doctors, true);
    await initDoctors();
    alert('Doctors saved successfully');
}

// Initialize leave dates
async function initLeaveDates() {
    const leaveDates = await getData('LeaveDates');
    // We'll just load them for the scheduling algorithm
}

// Add a leave date
async function addLeaveDate() {
    const doctor = document.getElementById('leaveDoctor').value;
    const date = document.getElementById('leaveDate').value;
    
    if (!doctor || !date) {
        alert('Please select a doctor and date');
        return;
    }
    
    const leaveDates = await getData('LeaveDates');
    const newLeave = [[doctor, date]];
    
    await postData('LeaveDates', newLeave, false);
    document.getElementById('leaveDate').value = '';
    alert('Leave date added');
}

// Clear all leave dates
async function clearLeaveDates() {
    if (confirm('Are you sure you want to clear all leave dates?')) {
        await postData('LeaveDates', [], true);
        alert('Leave dates cleared');
    }
}

// Add custom duty type
function addCustomDuty() {
    const date = document.getElementById('customDutyDate').value;
    const type = document.getElementById('customDutyType').value;
    
    if (!date) {
        alert('Please select a date');
        return;
    }
    
    customDuties[date] = type;
    updateCustomDutiesDisplay();
    document.getElementById('customDutyDate').value = '';
}

// Update custom duties display
function updateCustomDutiesDisplay() {
    const container = document.getElementById('customDutyDates');
    container.innerHTML = '';
    
    for (const [date, type] of Object.entries(customDuties)) {
        const div = document.createElement('div');
        div.className = 'badge bg-secondary me-2 mb-2';
        div.innerHTML = `${date}: ${type}-hour <span class="ms-2 remove-duty" data-date="${date}">×</span>`;
        container.appendChild(div);
        
        div.querySelector('.remove-duty').addEventListener('click', function() {
            delete customDuties[this.dataset.date];
            updateCustomDutiesDisplay();
        });
    }
}

// Generate schedule
async function generateSchedule() {
    const startDate = document.getElementById('startDate').value;
    const duration = parseInt(document.getElementById('duration').value);
    const defaultDutyType = document.getElementById('defaultDutyType').value;
    
    if (!startDate || isNaN(duration) || duration < 1) {
        alert('Please enter valid start date and duration');
        return;
    }
    
    const doctorsData = await getData('Doctors');
    const doctors = doctorsData.map(d => d[0]).filter(d => d);
    
    if (doctors.length < 2) {
        alert('Please add at least 2 doctors');
        return;
    }
    
    const leaveDatesData = await getData('LeaveDates');
    const leaveDates = {};
    leaveDatesData.forEach(ld => {
        if (ld[0] && ld[1]) {
            if (!leaveDates[ld[0]]) leaveDates[ld[0]] = [];
            leaveDates[ld[0]].push(ld[1]);
        }
    });
    
    const schedule = createSchedule(doctors, new Date(startDate), duration, defaultDutyType, leaveDates);
    await postData('Schedule', schedule, true);
    await loadSchedule();
    await loadDistribution();
    alert('Schedule generated successfully');
}

// Create schedule algorithm
function createSchedule(doctors, startDate, durationMonths, defaultDutyType, leaveDates) {
    const schedule = [];
    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + durationMonths);
    
    const dutyCounts = {};
    const weekendCounts = {};
    doctors.forEach(doctor => {
        dutyCounts[doctor] = { total: 0, weekdays: 0, saturdays: 0, sundays: 0 };
        weekendCounts[doctor] = 0;
    });
    
    // Initialize last duty dates
    const lastDuty = {};
    doctors.forEach(doctor => {
        lastDuty[doctor] = null;
    });
    
    // Create date array
    const dateArray = [];
    let currentDate = new Date(startDate);
    while (currentDate < endDate) {
        dateArray.push(new Date(currentDate));
        currentDate.setDate(currentDate.getDate() + 1);
    }
    
    // Shuffle doctors for random assignment
    const shuffledDoctors = [...doctors].sort(() => Math.random() - 0.5);
    
    // Assign duties
    for (const date of dateArray) {
        const dateStr = formatDate(date);
        const dayOfWeek = date.getDay();
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
        
        // Determine duty type (custom or default)
        const dutyType = customDuties[dateStr] || defaultDutyType;
        const is24Hour = dutyType === '24';
        
        // Find available doctors (not on leave and not having consecutive duty)
        const availableDoctors = shuffledDoctors.filter(doctor => {
            // Check leave dates
            if (leaveDates[doctor] && leaveDates[doctor].includes(dateStr)) {
                return false;
            }
            
            // Check consecutive duty
            if (lastDuty[doctor] && (date - lastDuty[doctor]) < (is24Hour ? 2 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000)) {
                return false;
            }
            
            return true;
        });
        
        if (availableDoctors.length < 2) continue;
        
        // Sort by duty count (doctors with fewer duties get priority)
        availableDoctors.sort((a, b) => {
            // First by total duties
            if (dutyCounts[a].total !== dutyCounts[b].total) {
                return dutyCounts[a].total - dutyCounts[b].total;
            }
            
            // Then by weekend duties if it's a weekend
            if (isWeekend && weekendCounts[a] !== weekendCounts[b]) {
                return weekendCounts[a] - weekendCounts[b];
            }
            
            return 0;
        });
        
        // Select doctors for this day
        const selectedDoctors = availableDoctors.slice(0, 2);
        
        // Assign campus (alternate between campuses for fairness)
        const campus1Doctor = selectedDoctors[0];
        const campus2Doctor = selectedDoctors[1];
        
        // Update duty counts
        dutyCounts[campus1Doctor].total++;
        dutyCounts[campus2Doctor].total++;
        
        if (dayOfWeek === 6) {
            dutyCounts[campus1Doctor].saturdays++;
            dutyCounts[campus2Doctor].saturdays++;
            weekendCounts[campus1Doctor]++;
            weekendCounts[campus2Doctor]++;
        } else if (dayOfWeek === 0) {
            dutyCounts[campus1Doctor].sundays++;
            dutyCounts[campus2Doctor].sundays++;
            weekendCounts[campus1Doctor]++;
            weekendCounts[campus2Doctor]++;
        } else {
            dutyCounts[campus1Doctor].weekdays++;
            dutyCounts[campus2Doctor].weekdays++;
        }
        
        // Update last duty dates
        lastDuty[campus1Doctor] = new Date(date);
        lastDuty[campus2Doctor] = new Date(date);
        if (is24Hour) {
            lastDuty[campus1Doctor].setDate(lastDuty[campus1Doctor].getDate() + 1);
            lastDuty[campus2Doctor].setDate(lastDuty[campus2Doctor].getDate() + 1);
        }
        
        // Add to schedule
        schedule.push([
            dateStr,
            dayOfWeek === 0 ? 'Sunday' : dayOfWeek === 6 ? 'Saturday' : 'Weekday',
            campus1Doctor,
            campus2Doctor,
            is24Hour ? '24-hour' : '12-hour'
        ]);
    }
    
    return [['Date', 'Day', 'Campus 1 Doctor', 'Campus 2 Doctor', 'Duty Type'], ...schedule];
}

// Load schedule table
async function loadSchedule() {
    const schedule = await getData('Schedule');
    const table = document.getElementById('scheduleTable');
    
    if (!schedule || schedule.length <= 1) {
        table.innerHTML = '<p>No schedule generated yet</p>';
        return;
    }
    
    let html = '<table class="table table-bordered table-hover"><thead><tr>';
    schedule[0].forEach(header => {
        html += `<th>${header}</th>`;
    });
    html += '</tr></thead><tbody>';
    
    for (let i = 1; i < schedule.length; i++) {
        const row = schedule[i];
        const dayClass = row[1] === 'Saturday' || row[1] === 'Sunday' ? 'weekend' : '';
        const campus1Class = 'campus1';
        const campus2Class = 'campus2';
        
        html += `<tr class="${dayClass}">`;
        html += `<td>${row[0]}</td>`;
        html += `<td>${row[1]}</td>`;
        html += `<td class="${campus1Class}">${row[2]}</td>`;
        html += `<td class="${campus2Class}">${row[3]}</td>`;
        html += `<td>${row[4]}</td>`;
        html += '</tr>';
    }
    
    html += '</tbody></table>';
    table.innerHTML = html;
}

// Load distribution table
async function loadDistribution() {
    const doctors = await getData('Doctors');
    const schedule = await getData('Schedule');
    
    if (!doctors || doctors.length === 0 || !schedule || schedule.length <= 1) {
        document.getElementById('distributionTable').innerHTML = '<p>No data available</p>';
        return;
    }
    
    // Calculate distribution
    const distribution = {};
    doctors.forEach(doctor => {
        if (doctor[0]) {
            distribution[doctor[0]] = {
                total: 0,
                weekdays: 0,
                saturdays: 0,
                sundays: 0,
                '12-hour': 0,
                '24-hour': 0
            };
        }
    });
    
    for (let i = 1; i < schedule.length; i++) {
        const row = schedule[i];
        const campus1Doctor = row[2];
        const campus2Doctor = row[3];
        const dayType = row[1];
        const dutyType = row[4];
        
        distribution[campus1Doctor].total++;
        distribution[campus2Doctor].total++;
        
        distribution[campus1Doctor][dutyType]++;
        distribution[campus2Doctor][dutyType]++;
        
        if (dayType === 'Weekday') {
            distribution[campus1Doctor].weekdays++;
            distribution[campus2Doctor].weekdays++;
        } else if (dayType === 'Saturday') {
            distribution[campus1Doctor].saturdays++;
            distribution[campus2Doctor].saturdays++;
        } else if (dayType === 'Sunday') {
            distribution[campus1Doctor].sundays++;
            distribution[campus2Doctor].sundays++;
        }
    }
    
    // Create table
    let html = '<table class="table table-bordered table-hover"><thead><tr>' +
               '<th>Doctor</th><th>Total</th><th>Weekdays</th><th>Saturdays</th><th>Sundays</th><th>12-hour</th><th>24-hour</th></tr></thead><tbody>';
    
    for (const doctor in distribution) {
        const stats = distribution[doctor];
        html += `<tr>
            <td>${doctor}</td>
            <td>${stats.total}</td>
            <td>${stats.weekdays}</td>
            <td>${stats.saturdays}</td>
            <td>${stats.sundays}</td>
            <td>${stats['12-hour']}</td>
            <td>${stats['24-hour']}</td>
        </tr>`;
    }
    
    html += '</tbody></table>';
    document.getElementById('distributionTable').innerHTML = html;
}

// Clear schedule
async function clearSchedule() {
    if (confirm('Are you sure you want to clear the schedule?')) {
        await postData('Schedule', [], true);
        await loadSchedule();
        await loadDistribution();
        alert('Schedule cleared');
    }
}

// Helper function to format date as YYYY-MM-DD
function formatDate(date) {
    const d = new Date(date);
    let month = '' + (d.getMonth() + 1);
    let day = '' + d.getDate();
    const year = d.getFullYear();
    
    if (month.length < 2) month = '0' + month;
    if (day.length < 2) day = '0' + day;
    
    return [year, month, day].join('-');
}

// Get data from Google Sheet
async function getData(sheetName) {
    try {
        const response = await fetch(`${SCRIPT_URL}?sheet=${sheetName}`);
        return await response.json();
    } catch (error) {
        console.error('Error fetching data:', error);
        return null;
    }
}

// Post data to Google Sheet
async function postData(sheetName, data, clearFirst = false) {
    try {
        let url = `${SCRIPT_URL}?sheet=${sheetName}&action=append&data=${encodeURIComponent(JSON.stringify(data))}`;
        if (clearFirst) {
            url = `${SCRIPT_URL}?sheet=${sheetName}&action=clear`;
            await fetch(url);
            url = `${SCRIPT_URL}?sheet=${sheetName}&action=append&data=${encodeURIComponent(JSON.stringify(data))}`;
        }
        await fetch(url, { method: clearFirst ? 'POST' : 'POST' });
    } catch (error) {
        console.error('Error posting data:', error);
    }
}
