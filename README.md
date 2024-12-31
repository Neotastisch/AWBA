# AWBA: Autonomous Web Browsing Assistant

## This is a work in progress, but should be functional.

An intelligent web automation assistant powered by OpenAI's GPT-4 Vision and Puppeteer. This project enables natural language-driven web interactions, allowing users to automate complex web tasks through simple text commands.

## Features

- 🤖 Natural Language Task Processing
- 🌐 Automated Web Navigation
- 📸 Real-time Visual Feedback
- 🔄 Step-by-Step Task Execution
- 📝 Detailed Task Logging
- ⚡ Interactive User Interface
- 🔍 Smart Element Detection
- 💬 Human Input Support

## Prerequisites

- Node.js (Latest LTS version recommended)
- NPM or Yarn
- OpenAI API Key

## Installation

1. Clone the repository

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the root directory:
```env
OPENAI_API_KEY=your_api_key_here
USER_EMAIL=your_email@example.com
USER_NAME=Your Name
USER_LOCATION=Your Location
PORT=3000
```
Note: You do not have to provide accurate details in USER_EMAIL, USER_NAME, and USER_LOCATION. This is just for the AI to be able to help you input your details.

## Usage

1. Start the server:
```bash
npm start
```

2. Open your browser and navigate to `http://localhost:3000`

3. Enter your task description in the input field and click "Start Task"

## Example Tasks

- "Find the best price for a MacBook Pro 16-inch"
- "Book a table for 2 at a nearby Italian restaurant"
- "Check the weather forecast for next week"
- "Research and compare flight prices to New York"

## Technical Details

### Architecture

- Frontend: HTML, CSS, JavaScript with WebSocket communication
- Backend: Node.js with Express
- Browser Automation: Puppeteer
- AI: OpenAI GPT-4 Vision API
- Real-time Updates: WebSocket Protocol

### Key Components

- Task Planning: AI-driven task breakdown and execution strategy
- Visual Processing: Screenshot analysis for context-aware decisions
- Element Detection: Smart identification of clickable elements and form inputs
- Error Handling: Robust recovery and alternative action paths
- Task Logging: Detailed execution logs for debugging and analysis

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

For support, please open an issue in the GitHub repository

---

Made with ❤️ by Neo