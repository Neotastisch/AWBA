const puppeteer = require('puppeteer');
const dotenv = require('dotenv');
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const OpenAI = require('openai');
const fs = require('fs').promises;
dotenv.config();
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const openai = new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENROUTER_API_KEY,
  })

const model = "anthropic/claude-3.5-sonnet";

/*
Tested Models:
- claude 3.5 sonnet - Best total so far, slightly better than gpt-4o. Has problems with large context.
- openai/o1-mini - Best responses so far, but slow and expensive.

- gpt-4o - Good enough, but struggles with visual tasks
- deepseek/deepseek-chat - Good responses, but not as good
- anthracite-org/magnum-v4-72b - Not good enough, doesnt understand the context
- qwen/qvq-72b-preview - Struggles with context and visual tasks
- perplexity/llama-3.1-sonar-small-128k-online - Responses not in the correct format.
- cohere/command-r - Better then other cohere models, but unlogical and repeat itself sometimes.
- cohere/command-r7b-12-2024 - Looked promising at first, but repeated itself. may need to try again in the future.
- cohere/command-r-plus-08-2024 - Same as above.
*/

let AIData = {
    userEmail: process.env.USER_EMAIL,
    userName: process.env.USER_NAME,
    time: new Date().toISOString(),
    date: new Date().toLocaleDateString(),
    location: process.env.USER_LOCATION,
}	

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Serve the main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

let browserInstance;
let currentPage;
let currentWs;
let isTaskRunning = false;

let lastStep = "";
let AIHistory = [];
let isWaitingForHumanInput = false;
let humanInputResolve = null;

// Add cleanup handlers for proper browser shutdown
process.on('SIGINT', cleanup);  // Ctrl+C
process.on('SIGTERM', cleanup); // Kill
process.on('exit', cleanup);    // Exit

async function cleanup() {
    if (browserInstance) {
        try {
            await browserInstance.close();
            browserInstance = null;
        } catch (error) {
            console.error('Error closing browser:', error);
        }
    }
    // Reset the current task log file
    currentTaskLogFile = null;
}

// WebSocket connection handling
wss.on('connection', (ws) => {
    currentWs = ws;
    
    ws.on('message', async (message) => {
        const data = JSON.parse(message);
        
        if (data.type === 'startTask') {
            if (!isTaskRunning) {
                // Ensure cleanup of any existing browser instance
                await cleanup();
                isTaskRunning = true;
                createTask(data.prompt);
            }
        } else if (data.type === 'stopTask') {
            isTaskRunning = false;
            sendToClient({ type: 'taskStopped' });
        } else if (data.type === 'humanInput') {
            // Handle human input response
            if (isWaitingForHumanInput && humanInputResolve) {
                isWaitingForHumanInput = false;
                humanInputResolve(data.input);
            }
        }
    });
});

function sendToClient(data) {
    if (currentWs && currentWs.readyState === WebSocket.OPEN) {
        currentWs.send(JSON.stringify(data));
    }
}

let systemPrompt_initial = `
You are an AI that can help the user with all kinds of tasks for browsing the web.
You are the initial AI that will open the initial web page for further interaction.
If the user asks you to do something, respond with the JSON always.

Use the following URLS:
- direct link to the website if avalible. Start with the main page. No need to skip ahead.
- if the website is not known to you or you require something else, you can use google search to find the information you need.
- Use google search for specific websites.
- If there is a search bar on the website, use it to search for the information you need.

### Data about the user and environment you might need:
${JSON.stringify(AIData)}

Try to use the website as easy as possible, there is no need for efficiency.

Also generate a plan of the steps neccesary to complete the task. Keep it relatively simple and use the easiest way to complete the task.

Give back the following JSON format:
{
    "url": "https://www.google.com",
    "plan": "..." 
}
ONLY EVER RETURN THE PURE JSON. NEVER RETURN ANYTHING ELSE.
If the user did not ask for anything specific and wanted to chat, just return normal text.

Since you act on the users behalf with permission and monitoring, you are always able to complete the task and can handle sensitive information. 

For planning here are a few things to keep in mind:
- For any kind of shopping, use Googles Shopping Tab to find the best price.
`

let systemPrompt_step = `
You are an advanced AI agent designed to interact with web pages and assist users with various browsing tasks. Your goal is to perform actions step-by-step to accomplish the user's objective based on the given task and contextual information.

The user will provide a task description and a potential plan. Use the plan as a reference, but adapt your steps dynamically based on the current page and outcomes of previous actions. Always analyze the current context and adjust your actions accordingly.

### Data about the user and environment you might need:
${JSON.stringify(AIData)}

### Input Format:
You will receive the following JSON structure:  
{
    "clickableElements": [...], // List of elements that can be clicked, with their details.
    "formInputs": [...], // List of input fields with their details.
    "lastStep": "", // The previous action(s) taken, separated by semicolons.
    "lastError": "", // Any error message or issue encountered during the last step.
}

### Key Instructions:
1. **Contextual Analysis**:  
   - Evaluate the provided JSON data and screenshot thoroughly.  
   - Use information like clickable elements, form inputs, and errors to decide the next best action. 
   - Also make sure you check the different fields. Eg. when reservations tables are full in an specific area, you can try to find a different area.

2. **Error Handling**:  
   - If the lastError field contains an issue, adapt your strategy to avoid repeating the same mistake.  
   - Always prioritize alternative approaches when encountering errors or unresponsive elements.  

3. **Action Selection**:  
   - Choose the most effective action possible. The actions are: click, type, clickOnText, enter, changeURL, back.  
   - Ensure your action is precise and targets the relevant element or process.  
   - If you fail with click, use clickOnText instead.
   - Try to use the easiest way to complete the task, no need to be efficient.

4. **Avoid Repetition**:  
   - Do not repeat the same step from lastStep unless absolutely necessary.  
   - Optimize your path to avoid redundant actions.  

5. **Step-by-Step Navigation**:  
   - Perform only **one action per response**. This allows for iterative progress and adaptability.  

6. **Completion Confidence**:  
   - Set finished to true if the task is successfully completed or if you determine it is impossible to complete.  
   - Otherwise, continue navigating step-by-step.  

7. **Wait for Loading**:  
   - If a loading screen or delay is detected, include a wait time in your next action.  

### Output Format:
Always return your response in the following JSON structure, under no circumstances return anything else:  

{
    "action": "", // The action to perform: "click", "type", "clickOnText", "enter", "changeURL", "back", or "wait" or "scroll" or "requestInput".
    "element": "", // The full path or selector of the target element (not needed for "clickOnText" or "wait").
    "value": "", // The input value, URL, text, or wait time, or user input if applicable.
    "pressEnter": false, // Set to "true" if it should press enter after typing. Very useful for forms and input fields.
    "finished": false, // Set to "true" if the task is completed or impossible; otherwise, "false".
    "description": "" // A concise description of the action, including relevant details (e.g., element path, value).
}

NEVER RETURN ANYTHING ELSE THAN THE PURE JSON. SET FINISHED TO TRUE IF YOU THINK THE ACTION IS COMPLETE.

### Guidelines for Success:
- Think critically about the task and prioritize efficient navigation.
- Use visual analysis from the screenshot to supplement the provided JSON data.
- Adapt dynamically based on errors, unresponsive elements, or unforeseen scenarios.
- Always aim to minimize redundant steps while ensuring task accuracy.
- Write down your thoughts and reasoning before you return the JSON.
- Under not circumstances should you say that you are not able to interact with the website. You can.
- If you think the action is complete, set finished to true and return the JSON.
- Never use placeholder text/passwords in your response. Ask for user input instead.

Here is the input data:
`

let systemPrompt_finalize = `
You are an AI that helps users with web browsing tasks. You are now generating the final summary and conclusion of the completed task.

A few guidelines for your response:
- Summarize what was done during the task
- For shopping tasks: Include prices, specifications, and why this was the best choice
- For research tasks: Summarize the key findings
- For booking/reservation tasks: Confirm the details that were entered
- If alternatives were considered, explain why the final choice was made
- If there were any limitations or issues encountered, mention them
- Add any relevant recommendations or next steps for the user

You have access to:
1. The original task and plan
2. The full history of actions taken
3. The current page content
4. A screenshot of the final page

Please provide a comprehensive but concise summary that helps the user understand what was accomplished.

Here is the current page content and task context:
`

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


async function prepareBrowser() {
  // Create a persistent user data directory in the project folder
  const userDataDir = path.join(__dirname, 'browser_data');
  
  browserInstance = await puppeteer.launch({
    headless: false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--window-size=1920,1080',
      '--force-device-scale-factor=0.75',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-default-browser-check'
    ],
    defaultViewport: {
      width: 1920,
      height: 1080,
      deviceScaleFactor: 0.75
    },
    userDataDir: userDataDir
  });
  hideBrowser();
}

function extractJSON(str) {
    try {
        // First try direct parse
        return JSON.parse(str);
    } catch (e) {
        try {
            // Find anything that looks like JSON using regex
            const jsonRegex = /{[\s\S]*?}/g;
            const matches = str.match(jsonRegex);
            
            if (!matches) return null;
            
            // Try each match until we find valid JSON
            for (const match of matches) {
                try {
                    const parsed = JSON.parse(match);
                    // Verify it has the expected structure
                    if (parsed && typeof parsed === 'object') {
                        return parsed;
                    }
                } catch (e) {
                    continue;
                }
            }
            return null;
        } catch (e) {
            console.error('Failed to extract JSON:', e);
            return null;
        }
    }
}

async function initialAI(prompt) {
    sendToClient({ type: 'status', message: 'Getting initial plan...' });
    const response = await askAI([{ role: 'system', content: systemPrompt_initial }, { role: 'user', content: prompt }]);

    const parsed = extractJSON(response);
    if (!parsed || !parsed.url || !parsed.plan) {
        //send text to client
        console.log(response);
        
        sendToClient({ type: 'result', result: response });
        return;
    }

    await prepareBrowser();

    let url = parsed.url;
    let plan = parsed.plan;
    
    sendToClient({ 
        type: 'plan', 
        plan: plan,
        url: url
    });
    
    return {url, plan};
}

async function hideBrowser() {
   
}

async function showBrowser() {

}

async function navigateToURL(url) {
    sendToClient({ type: 'status', message: 'Navigating to URL...' });
    currentPage = await browserInstance.newPage();
    
    await currentPage.goto(url);

    try {
        await currentPage.waitForNavigation({ timeout: 5000 });
    } catch (error) {
        // Navigation timeout or error occurred, but we can continue
        console.log("Navigation wait timed out or failed, continuing anyway");
    }
    sendToClient({ type: 'status', message: 'Navigation complete' });
    return currentPage;
}

// Add this after other global variables
const LOGS_DIR = path.join(__dirname, 'task_logs');
let currentTaskLogFile = null; // Track current task's log file

// Add this function to handle log file creation and writing
async function saveStepToLog(prompt, step, isInitial = false) {
    try {
        // Create logs directory if it doesn't exist
        await fs.mkdir(LOGS_DIR, { recursive: true });
        
        if (isInitial) {
            // Create a sanitized filename based on the prompt and date
            const date = new Date();
            const dateStr = date.toISOString().split('T')[0];
            const timeStr = date.toTimeString().split(' ')[0].replace(/:/g, '-');
            const sanitizedPrompt = prompt.slice(0, 50) // Take first 50 chars
                .replace(/[^a-zA-Z0-9]/g, '_') // Replace non-alphanumeric with underscore
                .replace(/_+/g, '_') // Replace multiple underscores with single
                .toLowerCase();
            
            const logFileName = `${dateStr}_${timeStr}_${sanitizedPrompt}.txt`;
            currentTaskLogFile = path.join(LOGS_DIR, logFileName);
            
            // Create the initial file with header
            const header = `Task Log\n${'='.repeat(50)}\n\n`
                + `Task: ${prompt}\n`
                + `Date: ${date.toLocaleString()}\n`
                + `User: ${AIData.userName || 'Unknown'}\n`
                + `Location: ${AIData.location || 'Unknown'}\n\n`
                + `Steps:\n${'-'.repeat(50)}\n`;
            
            await fs.writeFile(currentTaskLogFile, header);
            console.log(`Created new log file: ${logFileName}`);
            return currentTaskLogFile;
        } else if (currentTaskLogFile) {
            // Format the step with timestamp
            const timestamp = new Date().toLocaleTimeString();
            const formattedStep = `[${timestamp}] ${step}\n`;
            
            // Append the step to the current task's file
            await fs.appendFile(currentTaskLogFile, formattedStep);
            return currentTaskLogFile;
        }
        
        return null;
    } catch (error) {
        console.error('Error saving step to log:', error);
        return null;
    }
}

// Add function to handle user input requests
async function requestUserInput(prompt) {
    return new Promise((resolve) => {
        isWaitingForHumanInput = true;
        humanInputResolve = resolve;
        
        // Send request to client
        sendToClient({
            type: 'requestInput',
            prompt: prompt
        });
    });
}

// Modify completeAIStep to handle the new action
async function completeAIStep(query, logFilePath){
    let pageContent = await getPageContent(currentPage);
    pageContent.lastStep = lastStep;
    pageContent.lastError = "";
    let screenshotData = await getPageScreenShotData();
    
    // Send screenshot to client
    sendToClient({ 
        type: 'screenshot', 
        image: screenshotData,
        lastStep: lastStep
    });

    // Create messages array with history
    let messages = [
        {
            role: 'system',
            content: systemPrompt_step + JSON.stringify(pageContent),
        }
    ];

    AIHistory.forEach(historyItem => {
        messages.push({
            role: 'assistant',
            content: historyItem
        });
    });

    messages.push({
        role: 'user',
        content: [
            { type: "text", text: query },
           { type: "image_url", image_url: { url: screenshotData } },
        ],
    });
    
    const response = await askAI(messages);
    console.log( response);
    
    try {
        const parsedResponse = extractJSON(response);
        if (!parsedResponse) {
            // If no action is found, treat it as a final result
            sendToClient({ 
                type: 'result', 
                result: response 
            });
        }
        if(parsedResponse.finished){
            return true;
        }

        // Validate required fields
        const requiredFields = ['action', 'element', 'value', 'finished', 'description'];
        for (const field of requiredFields) {
            if (!(field in parsedResponse)) {
                parsedResponse[field] = "";
            }
        }

        let { action, element, value, finished, description } = parsedResponse;
        lastStep = lastStep+";"+description;

        sendToClient({ 
            type: 'action', 
            action: action,
            description: description
        });
        

        try {
            if(action == "requestInput"){
                // Request and wait for user input
                const userInput = await requestUserInput(value);
                showBrowser();
                if (logFilePath) {
                    await saveStepToLog(query, `Requested user input: ${value}\nUser provided response`);
                }
                return false; // Continue with next step after getting input
            } else if(action == "click"){
                if (!element || element.trim() === '') {
                    // If element selector is empty, try clickOnText with the value
                    if (value) {
                        await clickOnText(value);
                    } else {
                        throw new Error('No valid selector or text provided for click action');
                    }
                } else {
                    let retryCount = 0;
                    const maxRetries = 3;
                    while (retryCount < maxRetries) {
                        try {
                            await currentPage.waitForSelector(element, { timeout: 10000 }); // Increased timeout
                            await currentPage.evaluate((selector) => {
                                const element = document.querySelector(selector);
                                if (!element) throw new Error(`Element not found: ${selector}`);
                                // Scroll with offset to ensure element is fully visible
                                const rect = element.getBoundingClientRect();
                                const offset = 100; // pixels from top
                                window.scrollTo({
                                    top: window.scrollY + rect.top - offset,
                                    behavior: 'smooth'
                                });
                            }, element);
                            await sleep(1000); // Increased wait time after scroll
                            
                            // Try different click methods
                            try {
                                await currentPage.click(element);
                            } catch (clickError) {
                                console.log("Standard click failed, trying alternative methods");
                                // Try JavaScript click as fallback
                                await currentPage.evaluate((selector) => {
                                    const element = document.querySelector(selector);
                                    if (element) {
                                        element.click({timeout: 3000});
                                    }
                                }, element);
                            }
                            break; // If successful, exit the retry loop
                        } catch (error) {
                            retryCount++;
                            if (retryCount === maxRetries) {
                                throw error; // Rethrow the error if all retries failed
                            }
                            await sleep(1000); // Wait before retry
                        }
                    }
                }
            } else if(action == "type"){
                await currentPage.waitForSelector(element, { timeout: 5000 });
                await currentPage.click(element);
                await sleep(100);
                await currentPage.keyboard.type(value);
                
                if(parsedResponse.pressEnter){
                    await sleep(100);
                    await currentPage.keyboard.press('Enter');
                }
            } else if(action == "clickOnText"){
                await clickOnText(value);
            } else if(action == "enter"){
                await currentPage.keyboard.press('Enter');
            } else if(action == "changeURL"){
                await currentPage.goto(value);
                await currentPage.waitForNavigation({ timeout: 30000 });
            } else if(action == "back"){
                await currentPage.goBack();
                await currentPage.waitForNavigation({ timeout: 5000 });
            } else if(action == "wait"){
                await sleep(parseInt(value));
            }else if(action == "scroll"){
                await currentPage.evaluate(() => {
                    window.scrollBy(0, window.innerHeight);
                });
            }
            await sleep(2000);
            
            // Log successful step
            if (logFilePath) {
                const stepDescription = `Success - ${action}: ${description}${value ? ` (${value})` : ''}`;
                await saveStepToLog(query, stepDescription);
            }
            
            AIHistory.push(response);
            return finished;
        } catch (error) {
            console.error('Error performing action:', error);
            pageContent.lastError = error.message;
            sendToClient({ 
                type: 'error', 
                error: error.message 
            });
            return false;
        }
    } catch (error) {
        console.error('Error parsing AI response:', error);
        pageContent.lastError = "Invalid AI response format: " + error.message;
        sendToClient({ 
            type: 'error', 
            error: "Invalid AI response format: " + error.message 
        });
        return false;
    }
}

async function finalizeAITask(prompt) {
    let textContent = await getPageContent(currentPage, true);
    let screenshotData = await getPageScreenShotData();
    
    // Create a properly formatted messages array
    let messages = [
        {
            role: 'system',
            content: systemPrompt_finalize
        }
    ];

    // Add the original task and plan as context
    messages.push({
        role: 'user',
        content: `Original task: ${prompt}`
    });

    // Add history items as properly formatted message objects
    let actionHistory = "Actions taken:\n";
    for (const historyItem of AIHistory) {
        try {
            if (typeof historyItem === 'string') {
                // Try to parse the history item as JSON to extract the action description
                try {
                    const parsed = JSON.parse(historyItem);
                    if (parsed.description) {
                        actionHistory += `- ${parsed.description}\n`;
                    }
                } catch (e) {
                    actionHistory += `- ${historyItem}\n`;
                }
            }
        } catch (error) {
            console.warn('Skipping invalid history item:', error);
        }
    }

    // Add the action history as context
    messages.push({
        role: 'assistant',
        content: actionHistory
    });

    // Add the current page content and screenshot
    messages.push({
        role: 'user',
        content: [
            {
                type: "text",
                text: `Current page content: ${JSON.stringify(textContent)}\n\nPlease provide a final summary and conclusion for this task.`
            },
            {
                type: "image_url",
                image_url: { url: screenshotData }
            }
        ]
    });

    const response = await askAI(messages);
    
    // Format the response for better readability
    const formattedResponse = response.trim()
        .replace(/\n{3,}/g, '\n\n') // Replace multiple newlines with double newline
        .replace(/\*\*/g, '') // Remove bold markdown
        .replace(/\n/g, '<br>') // Convert newlines to HTML breaks
        .replace(/^(.*?):/gm, '<strong>$1:</strong>'); // Make labels bold
    
    // Send both the raw and formatted response
    sendToClient({ 
        type: 'result', 
        result: formattedResponse,
        rawResult: response
    });
    
    // Also send as completed for consistency
    sendToClient({ 
        type: 'completed', 
        result: formattedResponse
    });
    
    return formattedResponse;
}

async function askAI(messages) {
    try {
        const response = await openai.chat.completions.create({
            model: model,
            messages: messages,
            temperature: 0.5,
            max_tokens: 4096,
            stream: false,
           // response_format: {
             //   "type": "json_object"
            //}
        });
        
        if (!response.choices || response.choices.length === 0) {
            console.error('Invalid response from OpenAI:', response);
            throw new Error('Invalid response from OpenAI');
        }
        
        
        return response.choices[0].message.content;
    } catch (error) {
        console.error('OpenAI API error:', error);
        if (error.response) {
            console.error('Error details:', error.response.data);
        }
        throw new Error(`OpenAI API error: ${error.message}`);
    }
}

async function getPageContent(page) {
    // Arrays to store the clickable elements and form inputs
    let clickableElements = [];
    let formInputs = [];

    /**
     * Processes a single frame to extract clickable elements and form inputs.
     *
     * @param {puppeteer.Frame} frame - The Puppeteer frame instance.
     */
    const processFrame = async (frame) => {
        try {
            // Extract clickable elements within the frame
            const frameClickable = await frame.evaluate(() => {
                const elements = [];

                // Define selectors for clickable elements
                const clickableSelectors = [
                    'a[href]', // Links with href
                    'button', // <button> elements
                    'input[type="button"]',
                    'input[type="submit"]',
                    '[onclick]' // Any element with onclick attribute
                ];

                // Iterate over each selector and collect matching elements
                clickableSelectors.forEach(selector => {
                    const nodeList = document.querySelectorAll(selector);
                    nodeList.forEach(elem => {
                        elements.push({
                            tag: elem.tagName.toLowerCase(),
                            text: elem.innerText.trim(),
                            // Generate a unique selector for the element
                            selector: generateUniqueSelector(elem)
                        });
                    });
                });

                /**
                 * Generates a unique CSS selector for a given element.
                 *
                 * @param {Element} element - The DOM element.
                 * @returns {string} A unique CSS selector string.
                 */
                function generateUniqueSelector(element) {
                    if (element.id) {
                        return `#${element.id}`;
                    }

                    // Try to generate a short but unique selector
                    let selector = element.tagName.toLowerCase();
                    const classes = Array.from(element.classList).filter(c => !c.includes(' '));
                    
                    if (classes.length > 0) {
                        // Use up to 2 classes to keep selector short but specific
                        selector += '.' + classes.slice(0, 2).join('.');
                    }

                    // Check if the selector is already unique
                    if (document.querySelectorAll(selector).length === 1) {
                        return selector;
                    }

                    // If not unique, traverse up the parent chain until we have a unique selector
                    let currentElement = element;
                    let steps = 0;
                    const maxSteps = 3; // Limit the number of parent levels we'll check

                    while (currentElement.parentElement && steps < maxSteps) {
                        let parentSelector = currentElement.parentElement.tagName.toLowerCase();
                        
                        // Add parent's id if available
                        if (currentElement.parentElement.id) {
                            return `#${currentElement.parentElement.id} > ${selector}`;
                        }

                        // Add parent's classes if available (up to 1 class)
                        const parentClasses = Array.from(currentElement.parentElement.classList).filter(c => !c.includes(' '));
                        if (parentClasses.length > 0) {
                            parentSelector += '.' + parentClasses[0];
                        }

                        // Check if combination with parent is unique
                        const newSelector = `${parentSelector} > ${selector}`;
                        if (document.querySelectorAll(newSelector).length === 1) {
                            return newSelector;
                        }

                        // If still not unique, add nth-child to current element
                        let siblings = Array.from(currentElement.parentElement.children);
                        let index = siblings.indexOf(currentElement) + 1;
                        const nthSelector = `${parentSelector} > ${selector}:nth-child(${index})`;
                        if (document.querySelectorAll(nthSelector).length === 1) {
                            return nthSelector;
                        }

                        currentElement = currentElement.parentElement;
                        steps++;
                    }

                    // If we still don't have a unique selector, fall back to a full path but with minimal information
                    return generateFullPath(element);
                }

                function generateFullPath(element) {
                    const path = [];
                    let current = element;
                    
                    while (current && current.nodeType === Node.ELEMENT_NODE) {
                        let selector = current.tagName.toLowerCase();
                        
                        if (current.id) {
                            return `#${current.id} > ${path.join(' > ')}`.replace(/^\ >\ /, '');
                        }
                        
                        // Add nth-child only if necessary
                        let siblings = Array.from(current.parentElement?.children || []);
                        if (siblings.filter(sibling => sibling.tagName === current.tagName).length > 1) {
                            let index = siblings.indexOf(current) + 1;
                            selector += `:nth-child(${index})`;
                        }
                        
                        path.unshift(selector);
                        current = current.parentElement;
                    }
                    
                    return path.join(' > ');
                }

                return elements;
            });

            // Extract form input elements within the frame
            const frameFormInputs = await frame.evaluate(() => {
                const inputs = [];

                // Define selectors for form inputs
                const inputSelectors = ['input', 'select', 'textarea'];

                // Iterate over each selector and collect matching elements
                inputSelectors.forEach(selector => {
                    const nodeList = document.querySelectorAll(selector);
                    nodeList.forEach(elem => {
                        inputs.push({
                            tag: elem.tagName.toLowerCase(),
                            type: elem.type || null,
                            name: elem.name || null,
                            value: elem.value || null,
                            placeholder: elem.placeholder || null,
                            html: elem.outerHTML,
                            // Generate a unique selector for the element
                            selector: generateUniqueSelector(elem)
                        });
                    });
                });

                /**
                 * Generates a unique CSS selector for a given element.
                 *
                 * @param {Element} element - The DOM element.
                 * @returns {string} A unique CSS selector string.
                 */
                function generateUniqueSelector(element) {
                    if (element.id) {
                        return `#${element.id}`;
                    }

                    // Try to generate a short but unique selector
                    let selector = element.tagName.toLowerCase();
                    const classes = Array.from(element.classList).filter(c => !c.includes(' '));
                    
                    if (classes.length > 0) {
                        // Use up to 2 classes to keep selector short but specific
                        selector += '.' + classes.slice(0, 2).join('.');
                    }

                    // Check if the selector is already unique
                    if (document.querySelectorAll(selector).length === 1) {
                        return selector;
                    }

                    // If not unique, traverse up the parent chain until we have a unique selector
                    let currentElement = element;
                    let steps = 0;
                    const maxSteps = 3; // Limit the number of parent levels we'll check

                    while (currentElement.parentElement && steps < maxSteps) {
                        let parentSelector = currentElement.parentElement.tagName.toLowerCase();
                        
                        // Add parent's id if available
                        if (currentElement.parentElement.id) {
                            return `#${currentElement.parentElement.id} > ${selector}`;
                        }

                        // Add parent's classes if available (up to 1 class)
                        const parentClasses = Array.from(currentElement.parentElement.classList).filter(c => !c.includes(' '));
                        if (parentClasses.length > 0) {
                            parentSelector += '.' + parentClasses[0];
                        }

                        // Check if combination with parent is unique
                        const newSelector = `${parentSelector} > ${selector}`;
                        if (document.querySelectorAll(newSelector).length === 1) {
                            return newSelector;
                        }

                        // If still not unique, add nth-child to current element
                        let siblings = Array.from(currentElement.parentElement.children);
                        let index = siblings.indexOf(currentElement) + 1;
                        const nthSelector = `${parentSelector} > ${selector}:nth-child(${index})`;
                        if (document.querySelectorAll(nthSelector).length === 1) {
                            return nthSelector;
                        }

                        currentElement = currentElement.parentElement;
                        steps++;
                    }

                    // If we still don't have a unique selector, fall back to a full path but with minimal information
                    return generateFullPath(element);
                }

                function generateFullPath(element) {
                    const path = [];
                    let current = element;
                    
                    while (current && current.nodeType === Node.ELEMENT_NODE) {
                        let selector = current.tagName.toLowerCase();
                        
                        if (current.id) {
                            return `#${current.id} > ${path.join(' > ')}`.replace(/^\ >\ /, '');
                        }
                        
                        // Add nth-child only if necessary
                        let siblings = Array.from(current.parentElement?.children || []);
                        if (siblings.filter(sibling => sibling.tagName === current.tagName).length > 1) {
                            let index = siblings.indexOf(current) + 1;
                            selector += `:nth-child(${index})`;
                        }
                        
                        path.unshift(selector);
                        current = current.parentElement;
                    }
                    
                    return path.join(' > ');
                }

                return inputs;
            });

            // Append the extracted elements to the main arrays
            clickableElements.push(...frameClickable);
            formInputs.push(...frameFormInputs);
        } catch (error) {
            console.warn(`Could not process frame: ${error.message}`);
            // Frames that are cross-origin may throw errors; these are skipped
        }
    };

    // Retrieve all frames on the page, including nested frames
    const allFrames = page.frames();

    // Process each frame sequentially
    for (const frame of allFrames) {
        await processFrame(frame);
    }

    //maximum if 300 each
    clickableElements = clickableElements.slice(0,300);
    formInputs = formInputs.slice(0, 300);
    return { clickableElements, formInputs };
}

async function clickOnText(textToClick) {
    let page = currentPage;
    // Retrieve all clickable elements
    const { clickableElements } = await getPageContent(page);
    
    // Normalize the target text for comparison
    const normalizedTarget = textToClick.trim().toLowerCase();
    
    // First try exact match
    let targetElement = clickableElements.find(elem => {
        const elemText = (elem.text || '').trim().toLowerCase();
        return elemText === normalizedTarget;
    });
    
    // If no exact match, try includes
    if (!targetElement) {
        targetElement = clickableElements.find(elem => {
            const elemText = (elem.text || '').trim().toLowerCase();
            return elemText.includes(normalizedTarget) || normalizedTarget.includes(elemText);
        });
    }

    if (targetElement) {
        try {
            // Use the unique selector to click the element
            await page.waitForSelector(targetElement.selector, { timeout: 10000 }); // Increased timeout
            await page.evaluate((selector) => {
                const element = document.querySelector(selector);
                if (!element) throw new Error(`Element not found: ${selector}`);
                element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, targetElement.selector);
            await sleep(1000); // Increased sleep time
            await page.click(targetElement.selector);
            console.log(`Clicked on element with text: "${textToClick}"`);
            return true;
        } catch (error) {
            console.error(`Error clicking on element: ${error.message}`);
            return false;
        }
    } else {
        console.warn(`No clickable element found with text: "${textToClick}"`);
        return false;
    }
}

async function getPageScreenShotData(){
    try {
        const screenshot = await currentPage.screenshot({ encoding: 'base64' });
        return `data:image/png;base64,${screenshot}`;
    } catch (error) {
        console.error('Error getting screenshot:', error);
        throw new Error('Failed to generate valid screenshot data');
    }
}


async function createTask(prompt) {
    if (!isTaskRunning) return;
    
    try {
        // Reset the current task log file before starting a new task
        currentTaskLogFile = null;
        
        // Initialize new log file for this task
        currentTaskLogFile = await saveStepToLog(prompt, '', true);
        let {url, plan} = await initialAI(prompt);
        if(!url || !plan) {
            currentTaskLogFile = null;
            return isTaskRunning = false;
        }
        
        if (currentTaskLogFile) {
            await saveStepToLog(prompt, `Initial Plan:\n${plan}\nStarting URL: ${url}\n`);
        }
        
        prompt = prompt+"\nPlan to complete the task: "+plan;
        await navigateToURL(url);
        
        let finished = false;
        while(!finished && isTaskRunning){
            finished = await completeAIStep(prompt, currentTaskLogFile);
        }
        
        if (isTaskRunning) {
            let result = await finalizeAITask(prompt);
            if (currentTaskLogFile) {
                await saveStepToLog(prompt, `\nFinal Result:\n${'-'.repeat(50)}\n${result}\n${'='.repeat(50)}\n`);
            }
            await sleep(1000);
            sendToClient({ 
                type: 'completed', 
                result: result 
            });
        }
        
        isTaskRunning = false;
        // Reset the current task log file after completion
        currentTaskLogFile = null;
    } catch (error) {
        console.error('Task error:', error);
        sendToClient({ 
            type: 'error', 
            error: error.message 
        });
        isTaskRunning = false;
        // Reset the current task log file on error
        currentTaskLogFile = null;
    }
}