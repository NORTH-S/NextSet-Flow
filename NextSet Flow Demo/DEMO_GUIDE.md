# NextSet Flow v4 demo guide

The story is: **describe your goal → confirm it if needed → see a timed route → keep training while the plan adapts**.

## Before the meeting

Open the [public demo](https://nextset-flow-demo.lilacghost32768.chatgpt.site) or double-click `NextSet Flow Demo.html`. No ChatGPT login, API key, billing activation or external model service is required. The website downloads the bundled model assets; the self-contained HTML can be used without a network connection. Visitors run separate synthetic gym sessions.

The screen should show **Local model ready**. The opening leg plan is labelled as an example, not as a model prediction. Its clear default request, “I want to train legs for 30 minutes.”, is recognised by the frozen model, so **Run full simulation** starts the default walkthrough in one click. More detailed examples or new wording may ask for a focus confirmation; select the intended focus under **Choose your focus to continue** when prompted.

Example requests:

> I have 30 minutes. Train legs, mostly machines, and avoid queues.

> 我有半小时，想练腿，尽量用固定器械，不想排队。

## Two-minute walkthrough

1. Say: “You tell the app what you want to train and how much time you have. Our small trained model recognises the focus locally; the scheduler uses the current floor to arrange the session.”
2. Choose an example or enter a request, then click **Plan my workout**. If the model asks for confirmation, select a focus. Show the **Focus recognised by our local model** or **Focus confirmed by you** label accurately.
3. Point out the **entrance**, equipment positions, **Free / In use / Unconfirmed** states, route and per-step timing. Later movements are labelled **Forecast**.
4. Click **Run full simulation**. If a newly changed or unsubmitted request needs confirmation, choose its focus first; playback then begins. The protagonist follows the highlighted walkways.
5. Watch **Another member needs longer**: the occupied time extends and the current suggestion, route and timing recalculate.
6. Watch **Your rest runs 90 seconds longer**: the active station stays with the current member while later timing updates.
7. Watch **Your next station becomes busy**: the remaining plan reorders when a suitable movement fits. The explanation and timeline replace the earlier forecast.
8. End with: “This lets us test whether people understand and trust an adapting workout. The prototype demonstrates the software flow; it does not yet prove reduced waiting in a real gym.”

Default leg playback takes roughly a minute or more at 15×; completion time follows the chosen session. Scripted disruptions drive real state transitions and calculations, rather than pre-rendered screen replacements.

## Confirmation and guard behavior

The classifier is an experimental seven-class model. Low-confidence requests ask for a focus selection. A selection is the user's confirmation, not a successful learned recognition; editing the text invalidates the pending confirmation and the request must be processed again.

Known medical tailoring, invalid time windows and unsupported experience levels stop planning. Choosing a focus does not bypass these checks. A request classified as `unsupported` also stops. These checks and labels are limited prototype controls, not a medical assessment.

Do not reduce the threshold or silently claim that a keyword fallback is the trained model during the presentation. The current model is deliberately the same frozen candidate that was evaluated separately.

## Explore manually

- **Start exercise / Finish exercise** checks equipment state and advances the plan.
- **+1 min rest** extends the active station estimate and updates remaining timing.
- **Other options** displays allowed alternatives.
- Click a station to inspect it or simulate a status change. Automatic playback disables conflicting manual actions.
- Expand the floor map for a larger view; use **Reset demo** to return to the opening example.

## Explain the technical split accurately

The trained classifier supplies only the training-focus category. Rules extract time, experience, supported exclusions and machine/queue preferences. A deterministic scheduler coordinates the current advisory allocation; a separate module forecasts later steps and routes. No external model API is called and no model predicts real equipment duration.

The classifier scored **76/105 (72.4%)** on an independently authored synthetic final test. All those requests were invented, not collected from members, so this is not a real-user accuracy claim. Raw scores are uncalibrated and the model still makes mistakes. Confidence-based confirmation improves the interaction but is not a safety guarantee.

Timings are estimates. Suggestions do not physically reserve equipment; passing an estimated finish does not confirm a station is free. Playback uses explicit synthetic finish confirmations. No real sensors, shared gym database, trainer approval, wait-time benefit, commercial value or user retention have been validated.

Tests and limitations remain in the separate `NextSet Flow Technical Validation` folder. Read the v4 addendum for the current integration; v3's API/billing description is historical.
