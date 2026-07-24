import requests

def test_close():
    # Login to get token
    res = requests.post("http://localhost:8000/auth/login", json={
        "email": "superadmin@uwindsor.ca",
        "password": "ChangeMe123!"
    })
    if res.status_code != 200:
        print("Login failed:", res.status_code, res.text)
        return
        
    token = res.json()["access_token"]
    
    # Get projects
    headers = {"Authorization": f"Bearer {token}"}
    projects = requests.get("http://localhost:8000/projects", headers=headers).json()
    if not projects:
        print("No projects to close")
        return
        
    # Find an active project
    active_proj = next((p for p in projects if p.get("status") == "active"), None)
    if not active_proj:
        print("No active projects to close")
        return
        
    p_id = active_proj["id"] if "id" in active_proj else active_proj["_id"]
    print(f"Closing project {p_id}...")
    
    # Close project
    close_res = requests.post(f"http://localhost:8000/projects/{p_id}/close", json={
        "disposition_type": "euthanized",
        "notes": "Test closure"
    }, headers=headers)
    
    print("Status:", close_res.status_code)
    print("Response:", close_res.text)

if __name__ == "__main__":
    test_close()
