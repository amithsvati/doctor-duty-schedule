// Replace with your Google Apps Script URL
const SCRIPT_URL = 'YOUR_GOOGLE_APPS_SCRIPT_URL';

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
    for (const date
