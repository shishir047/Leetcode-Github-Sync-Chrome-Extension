import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';
import bodyParser from 'body-parser';
import { execFile } from 'child_process';

const app = express();
const port = 3000;

// Use CORS middleware to allow requests from the extension
app.use(cors());
app.use(bodyParser.json());

app.post('/get-github-token', async (req, res) => {
  const { code } = req.body;

  try {
    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        client_id: 'Ov23liP2hf7xnHd7YAZF', // Replace with your GitHub OAuth client ID
        client_secret: 'e57c6cc38473d88abd7acef06c3b5570525ec338', // Replace with your GitHub OAuth client secret
        code: code
      })
    });

    if (!response.ok) {
      throw new Error(`Failed to get GitHub token: ${response.statusText}`);
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Error fetching GitHub token:', error);
    res.status(500).json({ error: 'Failed to fetch GitHub token' });
  }
});

app.post('/run_script', async (req, res) => {
  const { leetcode_session, github_token, github_repo } = req.body;

  // Save the LEETCODE_SESSION, GITHUB_TOKEN, and GITHUB_REPO to environment variables
  process.env.LEETCODE_SESSION = leetcode_session;
  process.env.GITHUB_TOKEN = github_token;
  process.env.GITHUB_REPO = github_repo;

  execFile('python', ['scripts/sync_solution_script.py'], (error, stdout, stderr) => {
    if (error) {
      console.error('Error running script:', error);
      res.status(500).json({ error: 'Failed to run script', details: stderr });
      return;
    }

    console.log('Script output:', stdout);
    res.json({ message: 'Script executed successfully', output: stdout });
  });
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
