# Doubao Decoupled Agent Service

This is the Python microservice that compiles the LangGraph state machine, orchestrating DeepSeek-V3 and Volcengine Doubao Image Generation API.

## Setup Instructions

1. **Install Dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

2. **Configure Environment**:
   Make sure you define the keys in the root `.env` file:
   ```env
   DEEPSEEK_API_KEY=sk-xxxx
   DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
   DOUBAO_API_KEY=your_volcengine_ark_api_key
   DOUBAO_ENDPOINT_ID=your_model_endpoint_id
   ```

3. **Start the Service**:
   Run the service from this directory:
   ```bash
   python main.py
   ```
   The service will run locally on `http://localhost:8000`.
