document.getElementById('fetch-cookie-button').addEventListener('click', () => {
  fetchingCookies();
  
});

function getActiveTab() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length === 0) {
        reject('No active tab found');
      } else {
        resolve(tabs[0]);
      }
    });
  });
}

function fetchingCookies() {
  getActiveTab().then((tab) => {
    chrome.cookies.get({ url: 'https://leetcode.com', name: 'LEETCODE_SESSION' }, (cookie) => {
      if (cookie) {
        document.getElementById('LEETCODE_SESSION').value = cookie.value;
        console.log('Fetched Leetcode Cookie:', cookie.value);


        
      } else {
        console.error('LEETCODE_SESSION cookie not found');
        alert('LEETCODE_SESSION cookie not found');
      }
    });
  }).catch(error => {
    console.error('Error fetching active tab:', error);
  });
}

document.getElementById('sync-button').addEventListener('click', async () => {
  try {
    console.log('Sync button clicked.');
    document.getElementById('spinner').style.display = 'block'; // Show spinner

    const leetcodeSession = document.getElementById('LEETCODE_SESSION').value;
    if (!leetcodeSession) {
      alert('Please enter LEETCODE_SESSION cookie');
      document.getElementById('spinner').style.display = 'none'; // Hide spinner if there's an error
      return;
    }

    chrome.storage.local.get(['githubToken', 'githubUsername'], async (result) => {
      if (!result.githubToken || !result.githubUsername) {
        if (chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({ action: 'link_github' }, (response) => {
            console.log('Response from link_github:', response);
            if (response.status === 'linked') {
              document.getElementById('github-status').innerText = `GitHub Linked: ${response.githubUsername}`;
              document.getElementById('signout-link').style.display = 'inline';
              syncSubmissions(leetcodeSession);
            } else {
              document.getElementById('github-status').innerText = 'GitHub Linking Failed';
              document.getElementById('spinner').style.display = 'none';
            }
          });
        } else {
          console.error('chrome.runtime.sendMessage is not available');
          document.getElementById('spinner').style.display = 'none';
        }
      } else {
        syncSubmissions(leetcodeSession);
      }
    });
  } catch (error) {
    console.error('Error syncing submissions:', error);
    document.getElementById('spinner').style.display = 'none';
  }
});

function syncSubmissions(leetcodeSession) {
  chrome.tabs.query({ active: true, currentWindow: true }, async ([tab]) => {
    if (tab.url.startsWith('chrome://')) {
      alert('Cannot execute scripts on a Chrome internal page. Please switch to a different tab.');
      document.getElementById('spinner').style.display = 'none';
      return;
    }
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      function: runPythonScript,
      args: [leetcodeSession]
    });
  });
}

function runPythonScript(leetcodeSession) {
  console.log('Running Python script with LEETCODE_SESSION:', leetcodeSession);
  if (chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage({ action: 'run_script', leetcodeSession: leetcodeSession }, (response) => {
      document.getElementById('spinner').style.display = 'none';
    });
  } else {
    console.error('chrome.runtime.sendMessage is not available');
    document.getElementById('spinner').style.display = 'none';
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Received message:', message);
  if (message.action === 'github_linked') {
    chrome.storage.local.get('githubUsername', (result) => {
      if (result.githubUsername) {
        document.getElementById('github-status').innerText = `GitHub Linked: ${result.githubUsername}`;
        document.getElementById('signout-link').style.display = 'inline';
      }
    });
  } else if (message.action === 'script_started') {
    document.getElementById('spinner').style.display = 'block';
    document.getElementById('sync-status').innerText = '';
  } else if (message.action === 'script_finished') {
    document.getElementById('spinner').style.display = 'none';
    document.getElementById('sync-status').innerText = 'Sync Completed';
  }
});

document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.local.get(['githubToken', 'githubUsername'], (result) => {
    if (result.githubToken && result.githubUsername) {
      document.getElementById('github-status').innerText = `GitHub Linked: ${result.githubUsername}`;
      document.getElementById('signout-link').style.display = 'inline';
    }
  });
});

// Sign out functionality
document.getElementById('signout-link').addEventListener('click', () => {
  chrome.storage.local.remove(['githubToken', 'githubUsername', 'githubRepo'], () => {
    document.getElementById('github-status').innerText = 'GitHub Link Removed';
    document.getElementById('signout-link').style.display = 'none';
  });
});
