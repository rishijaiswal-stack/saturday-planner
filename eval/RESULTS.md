# Scenario eval results

Run: 2026-11-16T16:49:24.057Z · 10/10 passed · 7/8 plans written by the LLM (rest by fallbacks)

| Case | Result | Outcome | Planned by | Stops | Cost | Budget used | Latency | LLM calls | Tokens (cached) | Problems |
|---|---|---|---|---|---|---|---|---|---|---|
| brief-bangalore | pass | plan | qwen/qwen3.8-27b | 16:25 Ulsoor Lake → 17:35 Bangalore International Centre → 19:00 Green Theory | ₹1706/₹2000 | 85% | 10.5s | 4 | 11332 (1280) | - |
| leh-generous-budget | pass | plan | openai/gpt-oss-20b | 16:15 Memorial Park → 17:30 Ladakhi women's cafe | ₹483/₹12000 | 4% | 23.1s | 6 | 16002 (2048) | - |
| mumbai-couple-text | pass | plan | openai/gpt-oss-120b | 16:15 Nita Mukesh Ambani Cultural Centre → 18:15 Carter Road promenade, Bandra → 19:35 Cafe Madras, Matunga → 21:00 The Art House | ₹1717/₹3500 | 49% | 7.6s | 3 | 7229 (2048) | - |
| delhi-tight-budget | pass | plan | rules_fallback | 09:10 Prime Chowk → 10:30 Gandhi Smriti | ₹79/₹500 | 16% | 12.8s | 4 | 11058 (3072) | - |
| vague-input | pass | clarify | - | - | - | - | 0.6s | 1 | 769 (512) | - |
| unknown-city | pass | clarify | - | - | - | - | 0.5s | 1 | 788 (0) | - |
| london-non-inr | pass | plan | openai/gpt-oss-120b | 12:05 National Gallery → 13:10 Garfunkel's → 14:20 Silver Cross | £53/£80 | 66% | 8.2s | 3 | 7020 (1024) | - |
| hampi-sparse-town | pass | plan | openai/gpt-oss-120b | 16:10 Sita Sarovara → 17:10 Photo Museum → 18:55 4 Pillar Structure → 20:10 Happy Hampi Cafe | ₹803/₹1500 | 54% | 8.2s | 3 | 6891 (2048) | - |
| pune-family-free | pass | plan | openai/gpt-oss-120b | 14:05 Jijamata Udyan → 15:20 NG park | ₹0/₹0 | 100% | 6.4s | 3 | 6593 (1024) | - |
| bangalore-indiranagar-area | pass | plan | openai/gpt-oss-120b | 11:05 Spoonful Sugar Pastisserie & cafè → 12:15 Sapna Book House → 13:15 The Rameshwaram Cafe, Indiranagar → 14:35 Bangalore International Centre → 16:25 Beanlore Coffee Roasters | ₹2504/₹3000 | 83% | 9.1s | 2 | 4302 (256) | - |

## Details

### brief-bangalore
- Left out: none
- Warnings: 0
- Notable events: openai/gpt-oss-120b produced a malformed tool call; retrying · openai/gpt-oss-120b rate-limited; switching model

### leh-generous-budget
- Left out: shopping: All nearby markets are high‑crowd and you requested to avoid crowds.
- Warnings: 6
- Notable events: openai/gpt-oss-120b rate-limited; retrying in 9s · openai/gpt-oss-120b rate-limited; switching model · qwen/qwen3.8-27b rate-limited; switching model

### mumbai-couple-text
- Left out: vegetarian food: No suitable option fit within your time window and constraints.
- Warnings: 2
- Notable events: Plan is valid but incomplete; asking the agent to address missing interests

### delhi-tight-budget
- Left out: history: No suitable option fit within your time window and constraints.
- Warnings: 2
- Notable events: Plan is valid but incomplete; asking the agent to address missing interests · Agent couldn't produce a valid plan in 3 attempts; using the rule-based planner.

### vague-input
- Left out: none
- Warnings: 0
- Notable events: none

### unknown-city
- Left out: none
- Warnings: 0
- Notable events: none

### london-non-inr
- Left out: museums: No suitable option fit within your time window and constraints.
- Warnings: 1
- Notable events: Plan is valid but incomplete; asking the agent to address missing interests

### hampi-sparse-town
- Left out: none
- Warnings: 2
- Notable events: Plan is valid but incomplete; asking the agent to address missing interests

### pune-family-free
- Left out: kids fun: All listed kids‑fun attractions charge a fee, which exceeds the zero‑budget constraint.
- Warnings: 2
- Notable events: Plan is valid but incomplete; asking the agent to address missing interests · openai/gpt-oss-120b produced a malformed tool call; retrying

### bangalore-indiranagar-area
- Left out: none
- Warnings: 1
- Notable events: none