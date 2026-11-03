<img src="custom_components/agenda/brand/icon@2x.png" alt="" width="112" align="right">

# Agenda for Home Assistant

Calendar-based scheduling for Home Assistant, inspired by the Agenda plugin of Jeedom.
Each room or device gets its own agenda, shown as a week you can edit by dragging blocks around.

[![Open your Home Assistant instance and open this repository inside HACS.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=jolabs40&repository=agenda-ha&category=integration)
[![Validate](https://github.com/jolabs40/agenda-ha/actions/workflows/validate.yml/badge.svg)](https://github.com/jolabs40/agenda-ha/actions/workflows/validate.yml)

[Version française](README.fr.md) · [Deutsche Version](README.de.md) · [Nederlandse versie](README.nl.md)

![Week view](docs/week.png)

[Watch the two-minute tour on YouTube](https://youtu.be/GYiXai78Mzg), with subtitles in nine languages.

An event sets what the linked devices should do (a temperature, a preset, on or off, a cover
position, an option, a value) and can run actions when it starts and ends. Outside events the
agenda goes back to its default state.

## Features

- A sidebar panel with four views:
  - Week: click an empty slot to add an event, drag a block to move it, pull its bottom edge to
    make it longer. Moving a repeated event asks whether it applies to that day or the whole series.
    On a touch screen, a long press picks a block up. A day can be copied to other days of the week.
  - Month: each day's events, with public and school holidays.
  - House: every agenda over one day, with what each device is doing now.
  - List: all events and how they repeat.
- Events repeat every N days, weeks (on chosen weekdays, or on even or odd weeks only) or months
  (on the same date, on the 2nd Monday, on the last Friday...), optionally until a date. Single
  days can be removed from or added to a series.
- The start or the end of an event can follow sunrise or sunset, with an offset.
- Conditions on entities: an event takes charge only while, for instance, someone is home or a
  window is closed.
- Public holidays of your country can be skipped, or used as the only days.
- Calendars can act as conditions: skip the days with an event in them (trips, absences), keep
  only those days, or both on the same event. With several calendars, an event in one of them is
  enough, or one is needed in each of them.
- A school holiday calendar can be set once for all agendas. Each repeating event then applies
  always, only during school term, or only during school holidays, and the week view marks the
  holidays.
- Start and end actions per event, edited with the regular Home Assistant action editor.
- An absence mode for the whole house: the agendas that follow it keep their away state until a
  date, or until it is stopped.
- Per agenda: a `calendar` entity (Calendar panel, calendar triggers), an Active switch that
  pauses the agenda, Now and Next change sensors.
- Actions for automations and voice assistants: skip the next occurrence, add or remove dates,
  start or end the absence mode.
- Non-admin users can be allowed to edit events.
- After a restart the linked devices are put back in the state the agenda expects (can be turned
  off per agenda).
- A dashboard card, `custom:agenda-card`.
- English, French, German and Dutch.

What an agenda can control:

| Kind | Entities | States |
|---|---|---|
| Thermostats | `climate` | temperature, preset, off |
| On / off | `switch`, `light`, `input_boolean`, `fan` | on (with brightness for lights), off |
| Covers | `cover` | open, closed, position |
| Selector | `select`, `input_select` | one of the options |
| Value | `number`, `input_number` | a number |
| Nothing | | actions only |

Thermostats that publish their preset temperatures (Versatile Thermostat does) show them next
to the preset names.

| House view | Event editor | Phone |
|---|---|---|
| ![House view](docs/house.png) | ![Event editor](docs/editor.png) | ![Phone](docs/mobile.png) |

## Installation

With HACS, use the button above, or go to HACS, open the menu, choose Custom repositories and add
`https://github.com/jolabs40/agenda-ha` with the Integration type. Download Agenda and restart
Home Assistant.

Without HACS, unzip `agenda.zip` from the [latest release](https://github.com/jolabs40/agenda-ha/releases/latest)
into a `custom_components/agenda` folder of your configuration (or copy that folder from this
repository) and restart Home Assistant.

Then add the Agenda integration from Settings > Devices & services. Each entry is one agenda;
more can be created from the panel with the + button. Everything else is set up in the Agenda
panel.

Requires Home Assistant 2024.7 or later. The `holidays` package is installed automatically. The
integration icon shows from Home Assistant 2026.3.

## How the state is chosen

- The event in progress sets the state. Outside events, the default state of the agenda applies.
  Events without a state (reminders, actions only) are ignored here.
- When events overlap, the one that started last wins, and the shorter one on a tie. A whole-day
  Weekend event and a Night event starting at midnight: the night wins until it ends, then the
  weekend takes over.
- On each change, end actions run first, then the state is applied, then start actions run.
  Thermostats get their setpoint at every event start, so a manual change lasts until the next
  event. Other devices are only called when their state differs.
- Times are local clock times: an event at 21:30 stays at 21:30 when daylight saving time changes.
- Turning the Active switch off pauses the agenda completely.

## Actions

Actions work as in automations, with three extra variables:

| Variable | Content |
|---|---|
| `agenda` | name of the agenda |
| `phase` | `start` or `end` |
| `event` | `id`, `name`, `start`, `end` (ISO dates) |

```yaml
- action: notify.mobile_app_phone
  data:
    message: "{{ event.name }} ({{ agenda }}) {{ 'starts' if phase == 'start' else 'ends' }}"
```

## Sunrise, sunset and conditions

Sun times are computed by Home Assistant, day by day, for the location set in Settings > System >
General. When the sun brings the end of an event before its start (sunset after a fixed 21:00 end
in summer), the event is skipped that day.

Conditions compare the state of an entity: `person.alex` is `home`, `binary_sensor.window` is not
`on`. They are read when the event starts and whenever the entity changes. An event whose
conditions stop holding hands over to the next event in charge, or to the default state; its end
actions still run.

## Absence mode

The button at the top of the panel starts it, until a date or until it is stopped; the actions
`agenda.set_absence` and `agenda.end_absence` do the same from an automation. Meanwhile each agenda
that follows it (an option in its settings) keeps its away state, or its default state, and runs
no action. At the end every agenda goes back to its schedule.

## Automations

| Action | Target | Data |
|---|---|---|
| `agenda.skip_next` | an agenda's calendar | `event` (optional name): removes the next occurrence |
| `agenda.add_dates` | an agenda's calendar | `event`, `dates`: adds occurrences on these days |
| `agenda.remove_dates` | an agenda's calendar | `event`, `dates`: removes the occurrences on these days |
| `agenda.set_absence` | | `until` (optional): starts the absence mode |
| `agenda.end_absence` | | ends it |
| `agenda.resync` | an agenda's calendar | puts the devices back in the state the agenda wants now |

```yaml
- action: agenda.skip_next
  target:
    entity_id: calendar.agenda_living_room
  data:
    event: Morning
```

## Public holidays

They follow the country set in Settings > System > General. Another country, or a region (a US
state, a German Land, Alsace-Moselle...), can be picked in the settings of any agenda and applies
to all of them.

## School holidays

Add a calendar holding the school holidays, for instance with the Remote Calendar integration and
the published calendar of your school zone, then pick it in the shared settings of any agenda.
In France the ministry publishes one per zone:
`https://fr.ftp.opendatasoft.com/openscol/fr-en-calendrier-scolaire/Zone-A.ics` (or `Zone-B`,
`Zone-C`, `Corse`).

A child away at boarding school during the week, for example: mark the weekday slots as School
term, and add an all-day daily event at the home temperature marked School holidays.

## Dashboard card

```yaml
type: custom:agenda-card
view: house                    # every agenda, today
agendas: [Bedroom, Living room] # optional filter
title: Heating                 # optional
```

```yaml
type: custom:agenda-card
view: week
agenda: Bedroom
```

Clicking the card opens the panel.

## Support

Agenda is free. If it is useful to you, you can buy me a coffee on [Ko-fi](https://ko-fi.com/jolabs40).

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/jolabs40)

A star on this repository also helps other people find it.

## License

[MIT](LICENSE)
