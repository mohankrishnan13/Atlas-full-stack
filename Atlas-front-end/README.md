# ATLAS: Advanced Traffic Layer Anomaly System

Welcome to the ATLAS frontend repository. This application is a modern, responsive, and AI-enhanced dashboard for security operations, built with Next.js, React, and Tailwind CSS.

## Table of Contents

- [Technology Stack](#technology-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Connecting to Your Backend](#connecting-to-your-backend)
- [Generative AI Integration](#generative-ai-integration)

---

## Technology Stack

The frontend is built with a curated set of modern technologies to ensure a high-quality, performant, and maintainable application:

- **Framework**: **Next.js 15** (with App Router)
- **Language**: **TypeScript**
- **UI Library**: **React 19**
- **Styling**: **Tailwind CSS**
- **Component Library**: **shadcn/ui** for foundational UI primitives.
- **Data Visualization**: **Recharts** for charts and graphs.
- **Icons**: **Lucide React** for the entire icon set.
- **Generative AI**: **Genkit** with **Google's Gemini** models.
- **Form Handling**: **React Hook Form** for robust and validated forms.

---

## Project Structure

The project follows a feature-oriented structure within the Next.js App Router paradigm.

```
/src
├── app
│   ├── (dashboard)         # Main application pages (e.g., Overview, Incidents)
│   │   ├── api-monitoring
│   │   ├── ...
│   │   └── layout.tsx      # Shared layout for the dashboard
│   ├── (auth)              # Authentication pages (Login, Signup, etc.)
│   │   └── layout.tsx      # Shared layout for auth cards
│   ├── globals.css         # Global styles & Tailwind theme
│   └── layout.tsx          # Root application layout
│
├── components
│   ├── ui                  # Core shadcn/ui components (Button, Card, etc.)
│   ├── dashboard           # Dashboard-specific components (Sidebar, Header)
│   └── auth                # Auth-specific components
│
├── ai
│   ├── flows               # Genkit server-side AI flows
│   └── genkit.ts           # Genkit configuration
│
├── context
│   └── EnvironmentContext.tsx # Manages "Cloud" vs "Local" state
│
├── lib
│   ├── api.ts              # Global fetch interceptor for backend requests
│   ├── types.ts            # TypeScript type definitions for all data structures
│   ├── utils.ts            # Utility functions
│   └── placeholder-images.json # Manages placeholder image data
│
└── ...
```

---

## Getting Started

1.  **Install dependencies**:
    ```bash
    npm install
    ```
2.  **Run the development server**:
    ```bash
    npm run dev
    ```
    The application will be available at `http://localhost:9002`.

---

## Connecting to Your Backend

This frontend connects directly to your backend API. It uses a custom `fetch` interceptor located at `src/lib/api.ts` to automatically manage authentication and base URLs for all requests.

### Step 1: Configure Your Backend URL

You must tell the frontend where your backend is located.

1.  Open the `.env` file in the root of the project.
2.  Set the `NEXT_PUBLIC_ATLAS_BACKEND_URL` variable to the full URL of your running backend server.

    ```
    NEXT_PUBLIC_ATLAS_BACKEND_URL=http://localhost:8000
    ```

### Step 2: Enable CORS on Your Backend

Because the frontend application (running on `localhost:9002`) makes direct calls to your backend server (e.g., `localhost:8000`), your backend **must** be configured to accept requests from the frontend's origin.

You need to enable Cross-Origin Resource Sharing (CORS) on your backend. Specifically, ensure your server's response headers include:

```
Access-Control-Allow-Origin: http://localhost:9002
Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization
```

### Step 3: How the `apiFetch` Interceptor Works

The file `src/lib/api.ts` exports a function called `apiFetch`. This function is used for all data fetching in the dashboard pages. It automatically performs the following actions:

1.  **Reads the Backend URL**: It reads the `NEXT_PUBLIC_ATLAS_BACKEND_URL` from your `.env` file.
2.  **Attaches Auth Token**: It retrieves an authentication token from `localStorage` (under the key `atlas_auth_token`) and automatically adds it to the `Authorization: Bearer <token>` header for every request.
3.  **Handles Session Expiry**: If the backend responds with a `401 Unauthorized` status, the interceptor will automatically clear the local token and redirect the user to the `/login` page.

When you need to make a request in a component, you simply use `apiFetch` instead of the standard `fetch`:

```typescript
// src/app/(dashboard)/overview/page.tsx
import { apiFetch } from '@/lib/api';

// ... inside your component's useEffect
const response = await apiFetch('/overview'); // This calls http://localhost:8000/overview
const data = await response.json();
// ...
```

If your backend has different endpoint paths (e.g., `/api/v1/dashboard-overview` instead of `/overview`), you will need to **update the path** passed to the `apiFetch` function in the corresponding page file.

### Step 4: Match Data Structures

The frontend expects data to be in a specific format, which is defined by TypeScript types in `src/lib/types.ts`.

For example, the `Incident` type is defined as:

```typescript
// src/lib/types.ts
export type Incident = {
    id: string;
    eventName: string;
    timestamp: string;
    severity: Severity;
    // ... and so on
};
```

Ensure your backend endpoints return data that matches these type definitions.

---

## Generative AI Integration

The application uses **Genkit** for all AI-powered features, such as the Daily Briefing and the AI Investigator.

-   **Flows**: All AI prompts and logic are defined as "flows" in `src/ai/flows/`. These are server-side functions marked with `'use server';`.
-   **Configuration**: The Genkit instance is configured in `src/ai/genkit.ts`. It defaults to using Google's Gemini models. You can change the model or provider here if needed.
-   **Calling Flows**: Client components import and call these flows directly, as if they were regular async functions. Next.js and Genkit handle the server-side execution automatically.
