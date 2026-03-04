# **App Name**: EAMS: Enterprise Anomaly Monitoring System

## Core Features:

- Global Navigation: Persistent left sidebar for primary navigation and top navigation bar for global context selection, environment, alerts, and user profile.
- Overview Dashboard: Displays a high-level summary including AI threat briefing, key metrics, a microservices health topology map, API requests chart, and recent system anomalies.
- API Monitoring Dashboard: Provides detailed API metrics, an AI baseline comparison chart, and a table for API routing and abuse analysis with endpoint categorization.
- Network Traffic Analysis: Shows network traffic metrics, app-aware traffic flow visualization, and a table of active network anomalies.
- Endpoint Security Monitoring: Tracks monitored endpoints, OS distribution, malware alerts via interactive charts, and displays Wazuh agent event logs with a device quarantine option.
- Database Monitoring Insights: Offers insights into database performance with key metrics, stacked area charts for operation types, and a suspicious activity table.
- Incident Investigation: Allows users to search security events, view event details, and access AI-driven investigation summaries with one-click remediation actions. AI tool to summarize the incidents
- Reporting and Settings Management: Includes options for generating custom reports and AI-driven report generation suggestions, scheduling report delivery, and adjusting system configurations, like thresholds. Also offers sub-navigation for settings adjustment, like alerts and baselines.

## Style Guidelines:

- Dark Mode Theme: Background uses a deep slate/navy (#233554), cards are on a slate background (#334155) with subtle borders for a high contrast look, fitting to be viewed in low ambient light.
- Severity Color Coding: Critical alerts are red (#F44336), high alerts are orange (#FF9800), medium alerts are yellow (#FFEB3B), and low/healthy statuses are green (#4CAF50).
- Font: 'Inter', a clean sans-serif font, is used throughout the dashboard for readability and a modern feel. Note: currently only Google Fonts are supported.
- The dashboard features a global layout with a persistent left sidebar and a top navigation bar, ensuring easy navigation and context switching.
- Responsive Design: The UI is fully responsive, ensuring seamless accessibility across various screen sizes.
- Lucide Icons: Use a consistent set of icons from Lucide to represent various features and actions, enhancing the dashboard's usability and visual appeal.
- Transitions: Use smooth transitions when toggling between sidebar pages and settings sub-menus, providing a polished and engaging user experience.