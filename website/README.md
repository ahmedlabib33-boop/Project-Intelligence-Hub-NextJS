# Project Intelligence Hub Website

This is the React / Next.js website version of Project Intelligence Hub.

It is designed for the Vercel free plan with GitHub sync.

## Local Run

```powershell
cd "D:\Project Intelligence Hub NextJS\website"
npm install
npm run dev
```

Open:

```text
http://localhost:3000
```

## Data Flow

```text
Project folders -> tools/generate_nextjs_website_data.py -> website/public/data
Project HTML outputs -> website/public/generated -> Next.js website
GitHub sync -> Vercel rebuild -> public website update
```

The website does not read from `C:\Users\pc\...` after deployment. Vercel reads the committed GitHub repository only.

## Vercel Free Plan Setup

1. Push this copied folder to GitHub using `RUN_FULL_PROJECT_NO_GIT_SYNC.bat`.
2. Open Vercel.
3. Import GitHub repository:
   `ahmedlabib33-boop/Samco-Project-Intelegent-Hub`
4. Set the Vercel project root directory to:
   `website`
5. Keep build command:
   `npm run build`
6. Keep output framework:
   `Next.js`
7. Deploy.

## Updating The Website

When project files change:

```powershell
cd "D:\Project Intelligence Hub NextJS"
python tools\generate_nextjs_website_data.py
cmd /c RUN_FULL_PROJECT_NO_GIT_SYNC.bat Once 30
```

After GitHub updates, Vercel rebuilds the website automatically.

## Included Pages

- Portfolio Decision Making Dashboard
- Sector analysis
- Project analysis
- Project deep-dive pages
- Embedded generated HTML reports per project

## Important

Do not put secrets into the website folder.

GitHub credentials must stay in environment variables only:

```text
GITHUB_TOKEN
GH_TOKEN
```
