# DialogIQ Flight Deck

App Name: DialogIQ (Communication Flight Simulator)

Theme & Aesthetics: Modern, sleek, dark-mode technical dashboard (slate/charcoal background #0F1117, indigo/cyan accent glows, crisp typography, clean bento-box card layouts). Think executive coaching platform meets interactive simulation workspace.

Core Concept: A communication training dashboard for managing practice scenarios, tracking conversational competency (open vs. closed questions), and reviewing past simulation history.

Please build a responsive Single Page Application with:

Top Header Bar:

Left: Logo with a "V2 Engine" badge.

Center: Minimalist navigation tabs (Active Scenarios, Skill Analytics, Past Simulations).

Right: User profile avatar and a prominent primary CTA button: + New Scenario.

Main Bento-Box Dashboard Grid:

Active Practice Scenarios (2-column span, top-left): Modular cards displaying active training modules (e.g., "Bob: Defensive Team Member" and "Teenage Daughter: Homework Friction"). Each card must include target archetype badges (e.g., Avoidant, High Resistance), a score pill (6/7 Breakthrough), and action buttons (Resume Practice, View Branch Tree).

Conversational Competency Meter (1-column span, top-right): A clean widget showing an Open-Ended Question Ratio progress meter (e.g., 78% Open / 22% Closed) with a summary insight text block ("Great job avoiding conversational dead-ends today!").

Recent Flight History (Full-width bottom section): A sleek table logging recent simulation runs with columns for Scenario Name, Date, Branches Tried, Final Score (with color-coded status badges like 🟢 Breakthrough or 🟡 Dead-end), and a Review link.

Make the UI highly polished using Tailwind CSS, smooth hover transitions on cards, and pre-populated realistic mock data so the dashboard looks completely lived-in right out of the box.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/a81261eb-1da6-4e1d-b2cc-17e1d3ae2992).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
