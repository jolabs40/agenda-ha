<img src="custom_components/agenda/brand/icon@2x.png" alt="" width="112" align="right">

# Agenda für Home Assistant

Zeitplanung per Kalender für Home Assistant, nach dem Vorbild des Agenda-Plugins von Jeedom.
Jeder Raum oder jedes Gerät bekommt eine eigene Agenda, als Woche dargestellt, die man durch
Verschieben von Blöcken bearbeitet.

[![Home Assistant öffnen und dieses Repository in HACS anzeigen.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=jolabs40&repository=agenda-ha&category=integration)
[![Validate](https://github.com/jolabs40/agenda-ha/actions/workflows/validate.yml/badge.svg)](https://github.com/jolabs40/agenda-ha/actions/workflows/validate.yml)

[English version](README.md) · [Version française](README.fr.md) · [Nederlandse versie](README.nl.md)

![Wochenansicht](docs/week.png)

[Die zweiminütige Vorstellung auf YouTube ansehen](https://youtu.be/GYiXai78Mzg), mit Untertiteln in neun Sprachen, auch auf Deutsch.

Ein Termin legt fest, was die verknüpften Geräte tun sollen (eine Temperatur, ein Modus, ein oder
aus, eine Rollladenposition, eine Option, ein Wert), und kann zu Beginn und am Ende Aktionen
ausführen. Außerhalb der Termine kehrt die Agenda in ihren Standardzustand zurück.

Die Bildschirmfotos sind auf Englisch; die Oberfläche erscheint auf Deutsch, wenn Home Assistant
auf Deutsch eingestellt ist.

## Funktionen

- Ein Panel in der Seitenleiste mit vier Ansichten:
  - Woche: ein Klick auf einen freien Zeitraum legt einen Termin an, ein Block wird per Ziehen
    verschoben und durch Ziehen am unteren Rand verlängert. Bei einem wiederholten Termin wählt man
    zwischen nur diesem Tag und der ganzen Serie. Auf einem Touchscreen hebt ein langes Drücken den
    Block an. Ein Tag lässt sich auf andere Tage der Woche kopieren.
  - Monat: die Termine jedes Tages, mit Feiertagen und Schulferien.
  - Haus: alle Agenden über einen Tag, mit dem, was jedes Gerät gerade tut.
  - Liste: alle Termine und ihre Wiederholung.
- Wiederholung alle N Tage, Wochen (an gewählten Wochentagen, oder nur in geraden oder ungeraden
  Wochen) oder Monate (am gleichen Datum, am 2. Montag, am letzten Freitag...), auf Wunsch bis zu
  einem Datum. Einzelne Tage lassen sich aus einer Serie entfernen oder hinzufügen.
- Beginn oder Ende eines Termins können dem Sonnenaufgang oder Sonnenuntergang folgen, mit
  Versatz.
- Bedingungen auf Entitäten: ein Termin übernimmt nur, solange zum Beispiel jemand zu Hause ist
  oder ein Fenster geschlossen ist.
- Die Feiertage des eigenen Landes können übersprungen werden oder die einzigen Tage sein.
- Kalender können als Bedingung dienen: Tage mit einem Termin darin überspringen (Reisen,
  Abwesenheiten), nur diese Tage behalten oder beides beim selben Termin. Bei mehreren Kalendern
  genügt ein Termin in einem davon, oder es braucht einen in jedem.
- Ein Kalender der Schulferien wird einmal für alle Agenden gewählt. Jeder wiederholte Termin gilt
  dann immer, nur in der Schulzeit oder nur in den Schulferien, und die Wochenansicht markiert die
  Ferien.
- Aktionen zu Beginn und am Ende jedes Termins, mit dem gewohnten Aktionseditor von Home Assistant.
- Ein Abwesenheitsmodus für das ganze Haus: die Agenden, die ihm folgen, behalten ihren
  Abwesenheitszustand bis zu einem Datum oder bis er beendet wird.
- Pro Agenda: eine `calendar`-Entität (Kalender-Panel, Kalender-Auslöser), ein Schalter Aktiv, der
  die Agenda pausiert, die Sensoren Jetzt und Nächste Änderung.
- Aktionen für Automatisierungen und Sprachassistenten: den nächsten Termin überspringen, Daten
  hinzufügen oder entfernen, den Abwesenheitsmodus starten oder beenden.
- Benutzer ohne Administratorrechte können Termine bearbeiten dürfen.
- Nach einem Neustart werden die verknüpften Geräte in den Zustand gebracht, den die Agenda
  vorsieht (pro Agenda abschaltbar).
- Eine Dashboard-Karte, `custom:agenda-card`.
- Auf Englisch, Französisch, Deutsch und Niederländisch.

Was eine Agenda steuern kann:

| Typ | Entitäten | Zustände |
|---|---|---|
| Thermostate | `climate` | Temperatur, Modus, aus |
| Ein / aus | `switch`, `light`, `input_boolean`, `fan` | ein (mit Helligkeit bei Lampen), aus |
| Rollläden | `cover` | offen, geschlossen, Position |
| Auswahl | `select`, `input_select` | eine der Optionen |
| Wert | `number`, `input_number` | eine Zahl |
| Nichts | | nur Aktionen |

Bei Thermostaten, die die Temperaturen ihrer Modi veröffentlichen (Versatile Thermostat tut das),
erscheinen sie neben den Namen der Modi.

| Hausansicht | Termineditor | Telefon |
|---|---|---|
| ![Hausansicht](docs/house.png) | ![Termineditor](docs/editor.png) | ![Telefon](docs/mobile.png) |

## Installation

Mit HACS den Knopf oben verwenden, oder in HACS das Menü öffnen, Benutzerdefinierte Repositories
wählen und `https://github.com/jolabs40/agenda-ha` mit dem Typ Integration hinzufügen. Agenda
herunterladen und Home Assistant neu starten.

Ohne HACS `agenda.zip` aus der [neuesten Version](https://github.com/jolabs40/agenda-ha/releases/latest)
in einen Ordner `custom_components/agenda` der Konfiguration entpacken (oder diesen Ordner aus dem
Repository kopieren) und Home Assistant neu starten.

Danach die Integration Agenda unter Einstellungen > Geräte & Dienste hinzufügen. Jeder Eintrag ist
eine Agenda; weitere lassen sich im Panel mit dem Knopf + anlegen. Alles andere wird im Agenda-Panel
eingestellt.

Erfordert Home Assistant 2024.7 oder neuer. Das Paket `holidays` wird automatisch installiert. Das
Symbol der Integration erscheint ab Home Assistant 2026.3.

## Welcher Zustand gilt

- Der laufende Termin bestimmt den Zustand. Außerhalb der Termine gilt der Standardzustand der
  Agenda. Termine ohne Zustand (Erinnerungen, nur Aktionen) zählen hier nicht.
- Überschneiden sich Termine, gewinnt der zuletzt begonnene, bei Gleichstand der kürzere. Ein
  ganztägiger Wochenend-Termin und ein Nacht-Termin, der um Mitternacht beginnt: die Nacht gewinnt
  bis zu ihrem Ende, dann übernimmt das Wochenende.
- Bei jedem Wechsel laufen zuerst die Aktionen am Ende, dann wird der Zustand angewendet, dann
  laufen die Aktionen zu Beginn. Thermostate erhalten ihren Sollwert zu Beginn jedes Termins, eine
  manuelle Änderung hält also bis zum nächsten Termin. Andere Geräte werden nur angesprochen, wenn
  ihr Zustand abweicht.
- Zeiten sind lokale Uhrzeiten: ein Termin um 21:30 bleibt bei der Zeitumstellung um 21:30.
- Der Schalter Aktiv pausiert die Agenda vollständig.

## Aktionen

Aktionen funktionieren wie in Automatisierungen, mit drei zusätzlichen Variablen:

| Variable | Inhalt |
|---|---|
| `agenda` | Name der Agenda |
| `phase` | `start` oder `end` |
| `event` | `id`, `name`, `start`, `end` (ISO-Daten) |

```yaml
- action: notify.mobile_app_telefon
  data:
    message: "{{ event.name }} ({{ agenda }}) {{ 'beginnt' if phase == 'start' else 'endet' }}"
```

## Sonnenaufgang, Sonnenuntergang und Bedingungen

Die Sonnenzeiten berechnet Home Assistant Tag für Tag für den Standort, der unter Einstellungen >
System > Allgemein eingestellt ist. Bringt die Sonne das Ende eines Termins vor seinen Beginn
(Sonnenuntergang nach einem festen Ende um 21:00 im Sommer), findet der Termin an diesem Tag nicht
statt.

Bedingungen vergleichen den Zustand einer Entität: `person.alex` ist `home`, `binary_sensor.fenster`
ist nicht `on`. Sie werden zu Beginn des Termins und bei jeder Änderung der Entität gelesen. Ein
Termin, dessen Bedingungen nicht mehr erfüllt sind, überlässt die Steuerung dem nächsten Termin oder
dem Standardzustand; seine Aktionen am Ende laufen trotzdem.

## Abwesenheitsmodus

Der Knopf oben im Panel startet ihn, bis zu einem Datum oder bis er beendet wird; die Aktionen
`agenda.set_absence` und `agenda.end_absence` tun dasselbe aus einer Automatisierung. In dieser Zeit
behält jede Agenda, die ihm folgt (eine Option in ihren Einstellungen), ihren Abwesenheitszustand
oder sonst ihren Standardzustand und führt keine Aktion aus. Am Ende kehrt jede Agenda zu ihrem
Programm zurück.

## Automatisierungen

| Aktion | Ziel | Daten |
|---|---|---|
| `agenda.skip_next` | der Kalender einer Agenda | `event` (Name, optional): entfernt den nächsten Termin |
| `agenda.add_dates` | der Kalender einer Agenda | `event`, `dates`: fügt an diesen Tagen Termine hinzu |
| `agenda.remove_dates` | der Kalender einer Agenda | `event`, `dates`: entfernt die Termine an diesen Tagen |
| `agenda.set_absence` | | `until` (optional): startet den Abwesenheitsmodus |
| `agenda.end_absence` | | beendet ihn |
| `agenda.resync` | der Kalender einer Agenda | bringt die Geräte in den Zustand, den die Agenda jetzt vorsieht |

```yaml
- action: agenda.skip_next
  target:
    entity_id: calendar.agenda_wohnzimmer
  data:
    event: Morgen
```

## Feiertage

Sie folgen dem Land, das unter Einstellungen > System > Allgemein eingestellt ist. Ein anderes Land
oder eine Region (ein Bundesland, ein Kanton, ein US-Bundesstaat...) lässt sich in den
Einstellungen jeder Agenda wählen und gilt für alle.

## Schulferien

Einen Kalender mit den Schulferien hinzufügen, zum Beispiel mit der Integration Remote Calendar und
einem veröffentlichten iCal-Kalender der Ferien des eigenen Bundeslandes, und ihn dann in den
gemeinsamen Einstellungen einer beliebigen Agenda wählen.

Ein Kind, das unter der Woche im Internat ist, zum Beispiel: die Wochentags-Termine als Schulzeit
markieren und einen täglichen ganztägigen Termin mit der Temperatur für zu Hause als Schulferien.

## Dashboard-Karte

```yaml
type: custom:agenda-card
view: house                        # alle Agenden, heute
agendas: [Schlafzimmer, Wohnzimmer] # optionaler Filter
title: Heizung                     # optional
```

```yaml
type: custom:agenda-card
view: week
agenda: Schlafzimmer
```

Ein Klick auf die Karte öffnet das Panel.

## Unterstützung

Agenda ist kostenlos. Wenn es dir nützt, kannst du mir auf [Ko-fi](https://ko-fi.com/jolabs40) einen Kaffee spendieren.

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/jolabs40)

Ein Stern für dieses Repository hilft anderen ebenfalls, es zu finden.

## Lizenz

[MIT](LICENSE)
