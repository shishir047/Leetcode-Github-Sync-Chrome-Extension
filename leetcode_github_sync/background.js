chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'run_script') {
    chrome.runtime.sendMessage({ action: 'script_started' });
    runPythonScript(request.leetcodeSession).then(() => {
      chrome.runtime.sendMessage({ action: 'script_finished' });
      sendResponse({ status: 'completed' });
    }).catch(error => {
      console.error('Error running script:', error);
      chrome.runtime.sendMessage({ action: 'script_finished' });
      sendResponse({ status: 'failed', error: error.message });
    });
    return true;
  } else if (request.action === 'link_github') {
    linkGitHub(sendResponse);
    return true;
  }
});

async function runPythonScript(leetcodeSession) {
  try {
    const token = await getGitHubToken();
    const repo = await getGitHubRepo(token);
    if (!token) {
      console.error('GitHub token is not available.');
      return;
    }

    const response = await fetch('http://localhost:3000/run_script', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        leetcode_session: leetcodeSession,
        github_token: token,
        github_repo: repo
      })
    });

    if (!response.ok) {
      throw new Error('Network response was not ok');
    }

    const data = await response.json();
    console.log('Script executed:', data);
    if (data.error) {
      console.error('Server error:', data.error);
    } else {
      console.log('Success:', data.message);
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

async function linkGitHub(sendResponse) {
  try {
    console.log('Starting GitHub authorization flow...');
    const token = await getGitHubToken();
    if (token) {
      const username = await getGitHubUsername(token);
      const repo = `LEETCODESYNC-${username}`;
      const repoExists = await checkIfRepoExists(token, username, repo);
      if (!repoExists) {
        await createRepo(token, repo);
      }
      chrome.storage.local.set({ githubToken: token, githubRepo: `${username}/${repo}`, githubUsername: username }, () => {
        console.log('GitHub token, repo, and username stored successfully.');
        sendResponse({ status: 'linked' });
        chrome.runtime.sendMessage({ action: 'github_linked' }, (response) => {
          if (chrome.runtime.lastError) {
            console.error('Error sending message:', chrome.runtime.lastError);
          } else {
            console.log('Message sent to popup:', response);
          }
        });
      });
    } else {
      console.error('GitHub token is not available.');
      sendResponse({ status: 'failed' });
    }
  } catch (error) {
    console.error('Error in linkGitHub:', error);
    sendResponse({ status: 'failed' });
  }
}

async function getGitHubToken() {
  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow(
      {
        url: `https://github.com/login/oauth/authorize?client_id=Ov23liP2hf7xnHd7YAZF&scope=repo&redirect_uri=https://${chrome.runtime.id}.chromiumapp.org/`,
        interactive: true
      },
      function (redirect_url) {
        if (chrome.runtime.lastError || !redirect_url) {
          console.error('chrome.runtime.lastError:', chrome.runtime.lastError);
          reject(chrome.runtime.lastError);
          return;
        }

        console.log('Redirect URL:', redirect_url);
        const code = new URL(redirect_url).searchParams.get('code');
        if (!code) {
          console.error('Authorization code is null');
          reject('Authorization code is null');
          return;
        }

        console.log('Authorization code:', code);

        fetch('http://localhost:3000/get-github-token', {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ code: code })
        }).then(response => response.json())
          .then(data => {
            console.log('Received token data:', data);
            resolve(data.access_token);
          })
          .catch(error => {
            console.error('Error fetching GitHub token:', error);
            reject(error);
          });
      }
    );
  });
}

async function getGitHubUsername(token) {
  return new Promise((resolve, reject) => {
    fetch('https://api.github.com/user', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    }).then(response => response.json())
      .then(data => {
        resolve(data.login);
      })
      .catch(error => {
        console.error('Error fetching GitHub username:', error);
        reject(error);
      });
  });
}

async function checkIfRepoExists(token, username, repo) {
  return new Promise((resolve, reject) => {
    fetch(`https://api.github.com/repos/${username}/${repo}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    }).then(response => {
      if (response.status === 404) {
        resolve(false);
      } else if (response.ok) {
        resolve(true);
      } else {
        reject(new Error('Failed to check repo existence'));
      }
    }).catch(error => {
      console.error('Error checking repo existence:', error);
      reject(error);
    });
  });
}

async function createRepo(token, repo) {
  return new Promise((resolve, reject) => {
    fetch('https://api.github.com/user/repos', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: repo,
        private: false
      })
    }).then(response => {
      if (response.ok) {
        resolve();
      } else {
        response.json().then(data => {
          reject(new Error(`Failed to create repo: ${data.message}`));
        });
      }
    }).catch(error => {
      console.error('Error creating repo:', error);
      reject(error);
    });
  });
}

async function getGitHubRepo(token) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(['githubRepo'], (result) => {
      if (result.githubRepo) {
        resolve(result.githubRepo);
      } else {
        getGitHubUsername(token)
          .then(username => {
            const repo = `LEETCODESYNC-${username}`;
            chrome.storage.local.set({ githubRepo: `${username}/${repo}` }, () => {
              resolve(`${username}/${repo}`);
            });
          })
          .catch(error => reject(error));
      }
    });
  });
}

async function save_submission_code_to_github(submission_details, question_details) {
  const filename = `${question_details['questionFrontendId']}.${question_details['titleSlug']}.${submission_details['lang']['name']}.txt`;
  const content = submission_details['code'].replace("\\n", "\n");
  const encoded_content = btoa(content);

  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${filename}`;
  const headers = {
    'Authorization': `token ${GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github.v3+json'
  };

  const data = {
    'message': `Add ${filename}`,
    'content': encoded_content,
    'branch': 'main'
  };

  const getFileResponse = await fetch(url, {
    method: 'GET',
    headers: headers
  });

  if (getFileResponse.status === 200) {
    const existingFileData = await getFileResponse.json();
    data.sha = existingFileData.sha;
  } else if (getFileResponse.status === 404) {
  } else {
    console.error('Error checking file existence:', getFileResponse.statusText);
    return;
  }

  const putResponse = await fetch(url, {
    method: 'PUT',
    headers: headers,
    body: JSON.stringify(data)
  });

  if (!putResponse.ok) {
    console.error('Error saving file to GitHub:', await putResponse.text());
    if (putResponse.status === 404) {
      await createRepo(GITHUB_REPO.split('/').pop());
      const retryPutResponse = await fetch(url, {
        method: 'PUT',
        headers: headers,
        body: JSON.stringify(data)
      });
      if (!retryPutResponse.ok) {
        console.error('Retry error saving file to GitHub:', await retryPutResponse.text());
      }
    }
  }
}
