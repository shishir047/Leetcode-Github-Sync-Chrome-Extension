import requests
import os
import json
import base64
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
import time

LEETCODE_SESSION = os.getenv('LEETCODE_SESSION')
GITHUB_TOKEN = os.getenv('GITHUB_TOKEN')
GITHUB_REPO = os.getenv('GITHUB_REPO')

HEADERS = {
    'cookie': f'LEETCODE_SESSION={LEETCODE_SESSION}',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
}

BASE_URL = "https://leetcode.com"
GRAPHQL_URL = f"{BASE_URL}/graphql/"


QUERY_SUBMISSION_IDS = """
query mySubmissions($offset: Int!, $limit: Int!) {
  submissionList(offset: $offset, limit: $limit) {
    submissions {
      id
      statusDisplay
      titleSlug
    }
    hasNext
  }
}
"""


QUERY_SUBMISSION_DETAILS = """
query submissionDetails($submissionId: Int!) {
  submissionDetails(submissionId: $submissionId) {
    code
    statusCode
    lang {
      name
    }
    question {
      questionId
      titleSlug
    }
  }
}
"""


QUERY_QUESTION_DETAILS = """
query questionTitle($titleSlug: String!) {
  question(titleSlug: $titleSlug) {
    questionId
    questionFrontendId
    title
    titleSlug
  }
}
"""


retry_strategy = Retry(
    total=20,
    status_forcelist=[429, 500, 502, 503, 504],
    allowed_methods=["HEAD", "GET", "OPTIONS", "POST"],
    backoff_factor=1
)

adapter = HTTPAdapter(max_retries=retry_strategy)
http = requests.Session()
http.mount("https://", adapter)
http.mount("http://", adapter)


def fetch_submission_ids(limit=20):
    offset = 0
    submission_ids = []
    already_added_questions = set()

    while True:
        variables = {'offset': offset, 'limit': limit}
        try:
            response = http.post(GRAPHQL_URL, headers=HEADERS, json={'query': QUERY_SUBMISSION_IDS, 'variables': variables}, timeout=10)
            response.raise_for_status()
        except requests.exceptions.RequestException as e:
            print(f"Failed to fetch submission IDs: {e}")
            break
        
        data = response.json()

        if 'data' not in data:
            print(f"Unexpected response format: {data}")
            break

        submissions = data['data']['submissionList']['submissions']
        for s in submissions:
            if s['statusDisplay'] == 'Accepted' and s['titleSlug'] not in already_added_questions:
                already_added_questions.add(s['titleSlug'])
                submission_ids.append(s)

        if not data['data']['submissionList']['hasNext']:
            break

        offset += limit
    
    return submission_ids

def fetch_submission_details(submission_id, retries=20):
    variables = {"submissionId": submission_id}
    for attempt in range(retries):
        response = http.post(GRAPHQL_URL, headers=HEADERS, json={'query': QUERY_SUBMISSION_DETAILS, 'variables': variables}, timeout=10)
        response.raise_for_status()
        
        data = response.json()
        if data == {'data': {'submissionDetails': None}}:
            time.sleep(60)
            continue
        if 'data' not in data:
            print(f"Unexpected response format for ID {submission_id} (Attempt {attempt+1}/{retries}): {data}")
            return None

        return data['data']['submissionDetails']
      
    return None

def fetch_question_details(title_slug, retries=3):
    variables = {"titleSlug": title_slug}
    
    for attempt in range(retries):
        try:
            response = http.post(GRAPHQL_URL, headers=HEADERS, json={'query': QUERY_QUESTION_DETAILS, 'variables': variables}, timeout=10)
            response.raise_for_status()
        except requests.exceptions.RequestException as e:
            print(f"Failed to fetch question details for title slug {title_slug} (Attempt {attempt+1}/{retries}): {e}")
            if response and response.content:
                print(f"Response content: {response.content}")
            time.sleep(1)
            continue
        
        try:
            data = response.json()
        except json.JSONDecodeError as e:
            print(f"Failed to decode JSON response for title slug {title_slug} (Attempt {attempt+1}/{retries}): {e}")
            print(f"Response content: {response.content}")
            return None

        if 'data' not in data:
            print(f"Unexpected response format for title slug {title_slug} (Attempt {attempt+1}/{retries}): {data}")
            return None

        return data['data']['question']

    return None

def create_github_repo(repo_name):
    url = "https://api.github.com/user/repos"
    headers = {
        'Authorization': f'token {GITHUB_TOKEN}',
        'Accept': 'application/vnd.github.v3+json'
    }
    data = {
        'name': repo_name,
        'private': False
    }
    response = requests.post(url, headers=headers, data=json.dumps(data))
    response.raise_for_status()

def save_submission_code_to_github(submission_details, question_details):
    filename = f"{question_details['questionFrontendId']}. {question_details['titleSlug']}.{submission_details['lang']['name']}"
    content = submission_details['code'].replace("\\n", "\n")
    encoded_content = base64.b64encode(content.encode('utf-8')).decode('utf-8')

    url = f"https://api.github.com/repos/{GITHUB_REPO}/contents/{filename}"
    headers = {
        'Authorization': f'token {GITHUB_TOKEN}',
        'Accept': 'application/vnd.github.v3+json'
    }
    data = {
        'message': f'Add {filename}',
        'content': encoded_content,
        'branch': 'main'
    }

    get_file_response = requests.get(url, headers=headers)
    if get_file_response.status_code == 200:
        existing_file_data = get_file_response.json()
        data['sha'] = existing_file_data['sha']
    elif get_file_response.status_code == 404:
        pass
    else:
        print(f"Error checking file existence: {get_file_response.status_code} - {get_file_response.text}")
        return

    put_response = requests.put(url, headers=headers, data=json.dumps(data))
    if put_response.status_code == 404:
        create_github_repo(GITHUB_REPO.split('/')[-1])
        put_response = requests.put(url, headers=headers, data=json.dumps(data))
    put_response.raise_for_status()

def main():
    all_submissions = fetch_submission_ids(limit=20)
    print(f"Total submissions ID fetched: {len(all_submissions)}")
    submissions = {}

    for submission in all_submissions:
        submission_id = submission['id']
        submission_details = fetch_submission_details(submission_id)
        
        if not submission_details:
            continue

        title_slug = submission_details['question']['titleSlug']
        submissions[title_slug] = {
            'submission_id': submission_id,
            'submission_details': submission_details
        }
            
    for title_slug, data in submissions.items():
        submission_id = data['submission_id']
        submission_details = data['submission_details']
        question_details = fetch_question_details(submission_details['question']['titleSlug'])
        
        if question_details:
            save_submission_code_to_github(submission_details, question_details)
            print(f"Downloaded and saved code for submission ID: {submission_id}")
        else:
            print(f"Failed to fetch question details for submission ID: {submission_id}")

if __name__ == "__main__":
    main()
