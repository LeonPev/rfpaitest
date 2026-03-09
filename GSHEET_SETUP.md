# Google Sheet Setup — One-Time Credentials

## Step 1 — Create a Google Cloud project

1. Go to https://console.cloud.google.com/
2. Click **Select a project** → **New Project** → name it anything (e.g. `rfpai`) → **Create**

## Step 2 — Enable APIs

In your new project, go to **APIs & Services → Library** and enable both:
- **Google Sheets API**
- **Google Drive API**

## Step 3 — Create OAuth credentials

1. Go to **APIs & Services → Credentials**
2. Click **+ Create Credentials → OAuth client ID**
3. If prompted to configure the consent screen:
   - Choose **External** → **Create**
   - Fill in **App name** (anything) and your email → **Save and Continue** through all steps
4. Back on **Create OAuth client ID**:
   - Application type: **Desktop app**
   - Name: anything → **Create**
5. Click **Download JSON** → save as `credentials.json` in this folder:
   ```
   c:\Users\Kimi\Desktop\src\rfpaitest\credentials.json
   ```

## Step 4 — Add yourself as a test user (required while app is in testing)

1. Go to **APIs & Services → OAuth consent screen**
2. Scroll to **Test users** → **+ Add users** → add your Gmail address

## Step 5 — Run the script

```bash
python create_gsheet.py
```

A browser window will open asking you to log in with your Google account.
After you approve, the script will create the sheet and print the link.

---

The token is cached after the first run — you won't need to log in again.
