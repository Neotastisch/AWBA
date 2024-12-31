let ws;
const statusDot = document.querySelector('.status-dot');
const statusText = document.querySelector('.status-text');
const startButton = document.getElementById('startTask');
const stopButton = document.getElementById('stopTask');
const taskInput = document.getElementById('taskInput');
const planContent = document.getElementById('planContent');
const actionContent = document.getElementById('actionContent');
const screenshot = document.getElementById('screenshot');
const resultContent = document.getElementById('resultContent');
const notifications = document.getElementById('notifications');

function connectWebSocket() {
    ws = new WebSocket(`ws://${window.location.host}`);
    
    ws.onopen = () => {
        updateStatus('Connected', 'success');
    };
    
    ws.onclose = () => {
        updateStatus('Disconnected', 'error');
        setTimeout(connectWebSocket, 1000); // Reconnect after 1 second
    };
    
    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        updateStatus('Error', 'error');
    };
    
    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleMessage(data);
    };
}

function handleMessage(data) {
    switch(data.type) {
        case 'status':
            updateStatus(data.message, 'running');
            break;
            
        case 'plan':
            showPlan(data.plan, data.url);
            break;
            
        case 'screenshot':
            updateScreenshot(data.image);
            updateLastStep(data.lastStep);
            break;
            
        case 'action':
            updateAction(data.action, data.description);
            break;
            
        case 'error':
            showNotification(data.error, 'error');
            updateStatus('Error', 'error');
            break;
            
        case 'result':
            showResult(data.result);
            updateStatus('Completed', 'success');
            resetButtons();
            break;
            
        case 'completed':
            showResult(data.result);
            updateStatus('Completed', 'success');
            resetButtons();
            break;
            
        case 'taskStopped':
            updateStatus('Stopped', 'error');
            resetButtons();
            break;
            
        case 'requestInput':
            showInputPrompt(data.prompt);
            break;
    }
}

function updateStatus(message, state) {
    statusText.textContent = message;
    statusDot.className = 'status-dot';
    if (state) {
        statusDot.classList.add(state);
    }
}

function showPlan(plan, url) {
    planContent.innerHTML = `
        <p><strong>Starting URL:</strong> ${url}</p>
        <p><strong>Plan:</strong></p>
        <p>${plan}</p>
    `;
    planContent.style.animation = 'none';
    planContent.offsetHeight; // Trigger reflow
    planContent.style.animation = null;
}

function updateScreenshot(imageData) {
    screenshot.src = imageData;
    screenshot.style.animation = 'none';
    screenshot.offsetHeight; // Trigger reflow
    screenshot.style.animation = null;
}

function updateLastStep(step) {
    const steps = step.split(';').filter(s => s.trim());
    if (steps.length > 0) {
        const lastStep = steps[steps.length - 1];
        actionContent.innerHTML = `<p>${lastStep}</p>`;
        actionContent.style.animation = 'none';
        actionContent.offsetHeight; // Trigger reflow
        actionContent.style.animation = null;
    }
}

function updateAction(action, description) {
    actionContent.innerHTML = `
        <p><strong>Action:</strong> ${action}</p>
        <p>${description}</p>
    `;
    actionContent.style.animation = 'none';
    actionContent.offsetHeight; // Trigger reflow
    actionContent.style.animation = null;
}

function showResult(result) {
    if (!result) return;
    
    // If result is an object with HTML formatting, use innerHTML
    if (typeof result === 'string' && (result.includes('<br>') || result.includes('<p>'))) {
        resultContent.innerHTML = result;
    } else {
        // Otherwise, create a text node to safely display the content
        resultContent.innerHTML = ''; // Clear existing content
        const textNode = document.createTextNode(result);
        const paragraph = document.createElement('p');
        paragraph.appendChild(textNode);
        resultContent.appendChild(paragraph);
    }
    
    // Add animation
    resultContent.style.animation = 'none';
    resultContent.offsetHeight; // Trigger reflow
    resultContent.style.animation = null;
    
    // Scroll result into view
    resultContent.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    
    notifications.appendChild(notification);
    
    // Remove notification after 5 seconds
    setTimeout(() => {
        notification.style.opacity = '0';
        setTimeout(() => {
            notifications.removeChild(notification);
        }, 300);
    }, 5000);
}

function resetButtons() {
    startButton.disabled = false;
    stopButton.disabled = true;
}

function startTask() {
    const prompt = taskInput.value.trim();
    if (!prompt) {
        showNotification('Please enter a task description', 'error');
        return;
    }
    
    ws.send(JSON.stringify({
        type: 'startTask',
        prompt: prompt
    }));
    
    startButton.disabled = true;
    stopButton.disabled = false;
    updateStatus('Running', 'running');
    
    // Clear previous content
    resultContent.innerHTML = '';
    actionContent.innerHTML = '';
}

function stopTask() {
    ws.send(JSON.stringify({
        type: 'stopTask'
    }));
}

function showInputPrompt(prompt) {
    // Create modal overlay
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    
    // Create modal content
    const modal = document.createElement('div');
    modal.className = 'modal';
    
    const promptText = document.createElement('p');
    promptText.textContent = prompt;
    
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'modal-input';
    
    const submitButton = document.createElement('button');
    submitButton.textContent = 'Submit';
    submitButton.className = 'modal-button';
    
    // Handle submit
    const handleSubmit = () => {
        const value = input.value.trim();
        if (value) {
            ws.send(JSON.stringify({
                type: 'humanInput',
                input: value
            }));
            document.body.removeChild(overlay);
        }
    };
    
    // Add event listeners
    submitButton.addEventListener('click', handleSubmit);
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            handleSubmit();
        }
    });
    
    // Assemble and show modal
    modal.appendChild(promptText);
    modal.appendChild(input);
    modal.appendChild(submitButton);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    
    // Focus input
    input.focus();
}

// Event Listeners
startButton.addEventListener('click', startTask);
stopButton.addEventListener('click', stopTask);

// Initialize WebSocket connection
connectWebSocket(); 