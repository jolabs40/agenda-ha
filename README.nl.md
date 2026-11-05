<img src="custom_components/agenda/brand/icon@2x.png" alt="" width="112" align="right">

# Agenda voor Home Assistant

Planning met een kalender voor Home Assistant, naar het voorbeeld van de Agenda-plugin van Jeedom.
Elke kamer of elk apparaat krijgt een eigen agenda, getoond als een week die je bewerkt door
blokken te verslepen.

[![Open je Home Assistant en toon deze repository in HACS.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=jolabs40&repository=agenda-ha&category=integration)
[![Validate](https://github.com/jolabs40/agenda-ha/actions/workflows/validate.yml/badge.svg)](https://github.com/jolabs40/agenda-ha/actions/workflows/validate.yml)

[English version](README.md) · [Version française](README.fr.md) · [Deutsche Version](README.de.md)

![Agenda in actie](docs/demo.webp)

[Bekijk de presentatie van twee minuten op YouTube](https://youtu.be/GYiXai78Mzg), met ondertitels in negen talen, ook in het Nederlands.

Een gebeurtenis bepaalt wat de gekoppelde apparaten moeten doen (een temperatuur, een modus, aan
of uit, een rolluikpositie, een optie, een waarde) en kan acties uitvoeren bij het begin en aan
het einde. Buiten gebeurtenissen keert de agenda terug naar haar standaardtoestand.

De schermafbeeldingen zijn in het Engels; de interface verschijnt in het Nederlands als Home
Assistant in het Nederlands staat.

## Functies

- Een paneel in de zijbalk met vier weergaven:
  - Week: een klik op een vrij tijdslot voegt een gebeurtenis toe, een blok verplaats je door het
    te slepen en verleng je door aan de onderrand te trekken. Bij een herhaalde gebeurtenis kies je
    tussen alleen deze dag en de hele reeks. Op een aanraakscherm pakt lang drukken het blok op.
    Een dag kun je naar andere dagen van de week kopiëren.
    Een blok noemt de kalenders waarvan zijn gebeurtenis afhangt, en omlijnt degene die hem die dag
    laat lopen; dagen die een kalender uit een reeks haalt, verschijnen gearceerd.
  - Maand: de gebeurtenissen van elke dag, met feestdagen en schoolvakanties.
  - Huis: alle agenda's over één dag, met wat elk apparaat nu doet en, bij thermostaten, de
    gemeten temperatuur onder de instelwaarde.
  - Lijst: alle gebeurtenissen en hun herhaling.
- Op een breed scherm staan de agenda's in een kolom, zoals in het Kalender-paneel: vink aan welke
  je wilt zien, zie wat elke agenda nu doet en wanneer hij wisselt, pauzeer hem of open zijn
  instellingen. Op een telefoon doen chips bovenaan hetzelfde. De knop Gebeurtenis toevoegen staat
  rechtsonder.
- Andere kalenders van Home Assistant (schoolvakanties, een gezinskalender...) vink je in dezelfde
  kolom aan; ze verschijnen gearceerd in week, maand en huis, alleen ter informatie.
- Herhaling elke N dagen, weken (op gekozen weekdagen, of alleen in even of oneven weken) of
  maanden (op dezelfde datum, op de 2e maandag, op de laatste vrijdag...), eventueel tot een datum.
  Losse dagen kun je uit een reeks halen of eraan toevoegen.
- Het begin of het einde van een gebeurtenis kan de zonsopgang of zonsondergang volgen, met een
  verschuiving, niet voor of uiterlijk op een gekozen tijd.
- Voorwaarden op entiteiten: een gebeurtenis neemt het alleen over zolang er bijvoorbeeld iemand
  thuis is, een raam dicht is of de buitentemperatuur onder 5 °C ligt; allemaal, of minstens één
  ervan.
- De feestdagen van je land kunnen worden overgeslagen, of de enige dagen zijn.
- Kalenders kunnen als voorwaarde dienen: dagen met een gebeurtenis erin overslaan (reizen,
  afwezigheden), alleen die dagen houden, of allebei bij dezelfde gebeurtenis. Bij meerdere
  kalenders volstaat een gebeurtenis in één ervan, of moet er een in elk staan.
  De feestdagen kunnen een van deze kalenders zijn, voor een gebeurtenis die op thuiswerkdagen of
  op feestdagen loopt. Een kalender kan ook alleen zijn gebeurtenissen met een bepaalde tekst
  tellen, zoals de dure dagen van een kalender met stroomtarieven.
- Een kalender van de schoolvakanties kies je één keer voor alle agenda's. Elke herhaalde
  gebeurtenis geldt dan altijd, alleen in de schoolperiode of alleen in de schoolvakantie, en het
  weekoverzicht markeert de vakanties.
- Acties bij het begin en aan het einde van elke gebeurtenis, met de gewone actie-editor van Home
  Assistant.
- Wijzigingen met de hand worden gerespecteerd: een met de hand ingesteld apparaat blijft zo tot de
  volgende wissel, of tot de volgende dag, of wordt meteen teruggezet, naar keuze per agenda. Een
  herstart houdt ze.
- Afwijkingen: Naar de volgende past de volgende wissel meteen toe, Nu toepassen (in de
  gebeurtenis-editor) past een gebeurtenis toe tot haar einde, Schema hervatten heft ze op.
- Elk apparaat wordt gevolgd. Is het niet beschikbaar, dan krijgt het zijn toestand zodra het
  terug is; neemt het die niet over, dan volgt een tweede poging en daarna een probleem onder
  Reparaties. Apparaten zonder terugmelding van hun toestand (rolluiken via radio) krijgen hun
  opdracht één keer, na elkaar met een korte pauze.
- Airco's: een gebeurtenis kan modus, ventilatorstand en zwenken samen met de temperatuur
  instellen, of alleen een modus (alleen ventilator, ontvochtigen).
- Een afwezigheidsmodus voor het hele huis: de agenda's die hem volgen, houden hun
  afwezigheidstoestand tot een datum, of tot hij wordt gestopt. De andere (lampen) kunnen intussen
  aanwezigheid nabootsen.
- Per agenda: een `calendar`-entiteit (Kalender-paneel, kalendertriggers), een schakelaar Actief die
  de agenda pauzeert, de sensoren Nu en Volgende wijziging.
- Acties voor automatiseringen en spraakassistenten: de volgende gebeurtenis overslaan, datums
  toevoegen of verwijderen, van het schema afwijken, de afwezigheidsmodus starten of beëindigen.
- Het logboek noemt de agenda die een apparaat heeft gewijzigd, en twee gebeurtenissen laten
  automatiseringen reageren.
- Gebruikers zonder beheerdersrechten kunnen gebeurtenissen mogen bewerken; start- en eindacties
  blijven bij de beheerders.
- Na een herstart worden de gekoppelde apparaten in de toestand gezet die de agenda verwacht (per
  agenda uit te schakelen), behalve de met de hand ingestelde.
- Een dashboardkaart, `custom:agenda-card`, met een visuele editor.
- Temperaturen in °C of °F, zoals ingesteld in Home Assistant.
- In het Engels, Frans, Duits en Nederlands.

Wat een agenda kan aansturen:

| Type | Entiteiten | Toestanden |
|---|---|---|
| Thermostaten | `climate` | temperatuur (met modus, ventilatorstand en zwenken voor airco's), voorinstelling, alleen modus, uit |
| Aan / uit | `switch`, `light`, `input_boolean`, `fan` | aan (met helderheid voor lampen), uit |
| Rolluiken | `cover` | open, dicht, positie |
| Keuzelijst | `select`, `input_select` | een van de opties |
| Waarde | `number`, `input_number` | een getal |
| Niets | | alleen acties |

Thermostaten die de temperatuur van hun modi publiceren (Versatile Thermostat doet dat), tonen die
naast de naam van de modus.

| Huisweergave | Gebeurtenis-editor | Telefoon |
|---|---|---|
| ![Huisweergave](docs/house.png) | ![Gebeurtenis-editor](docs/editor.png) | ![Telefoon](docs/mobile.png) |

## Installatie

Zoek Agenda in HACS (of gebruik de knop hierboven), download het en herstart Home Assistant.

Verschijnt het nog niet, voeg het dan toe als aangepaste repository: open in HACS het menu, kies
Aangepaste repositories en voeg `https://github.com/jolabs40/agenda-ha` toe met het type Integratie.

Zonder HACS `agenda.zip` van de [nieuwste versie](https://github.com/jolabs40/agenda-ha/releases/latest)
uitpakken in een map `custom_components/agenda` van je configuratie (of die map uit de repository
kopiëren) en Home Assistant herstarten.

Daarna de integratie Agenda toevoegen via Instellingen > Apparaten & diensten. Elk item is één
agenda; meer maak je in het paneel met de knop Nieuwe agenda. Al het andere stel je in het
Agenda-paneel in.

Vereist Home Assistant 2024.7 of nieuwer. Het pakket `holidays` wordt automatisch geïnstalleerd.
Het pictogram van de integratie verschijnt vanaf Home Assistant 2026.3.

## Welke toestand geldt

- De lopende gebeurtenis bepaalt de toestand. Buiten gebeurtenissen geldt de standaardtoestand van
  de agenda. Gebeurtenissen zonder toestand (herinneringen, alleen acties) tellen hier niet mee.
- Als gebeurtenissen overlappen, wint de laatst begonnen gebeurtenis, bij gelijkstand de kortste.
  Een weekendgebeurtenis van een hele dag en een nachtgebeurtenis die om middernacht begint: de
  nacht wint tot ze afloopt, daarna neemt het weekend het over.
- Bij elke wissel lopen eerst de acties aan het einde, dan wordt de toestand toegepast, dan lopen
  de acties bij het begin. Thermostaten krijgen hun instelwaarde bij het begin van elke
  gebeurtenis. Andere apparaten worden alleen aangesproken als hun toestand afwijkt, behalve
  apparaten zonder terugmelding: wat ze tonen is maar een aanname, dus krijgen ze altijd hun
  opdracht.
- Tijden zijn lokale kloktijden: een gebeurtenis om 21:30 blijft bij de overgang naar zomer- of
  wintertijd om 21:30.
- De schakelaar Actief pauzeert de agenda volledig.

## Wijzigingen met de hand

Een met de hand ingesteld apparaat, op het apparaat zelf of in Home Assistant, wordt als zodanig
herkend. De instelling Wijzigingen met de hand van elke agenda bepaalt wat er volgt:

| Keuze | Wat de agenda doet |
|---|---|
| Behouden tot de volgende wissel (standaard) | laat het tot het begin of einde van de volgende gebeurtenis |
| Behouden tot de volgende dag | laat het tot middernacht |
| Meteen teruggezet zoals de agenda wil | zet het na 5 seconden terug; na drie keer in tien minuten laat ze het tot de volgende wissel |
| De agenda gaat altijd voor | negeert het, de volgende wissel geldt zoals gewoonlijk |

Een herstart houdt deze wijzigingen, `agenda.resync` ook. Nu toepassen in de instellingen haalt
alle apparaten terug. De kolom toont "met de hand ingesteld tot...", en de sensor Nu noemt deze
apparaten in het attribuut `set_by_hand`.

Afwijkingen veranderen het schema zelf, tot de tijd die ze tonen (`override_until` op de sensor
Nu): Naar de volgende past de toestand van de volgende wissel meteen toe (nog eens: die daarna),
Nu toepassen in de gebeurtenis-editor past de toestand van die gebeurtenis toe tot het einde van
haar volgende keer. Schema hervatten heft beide op en haalt de met de hand ingestelde apparaten
terug.

## Acties

Acties werken zoals in automatiseringen, met drie extra variabelen:

| Variabele | Inhoud |
|---|---|
| `agenda` | naam van de agenda |
| `phase` | `start` of `end` |
| `event` | `id`, `name`, `start`, `end` (ISO-datums) |

```yaml
- action: notify.mobile_app_telefoon
  data:
    message: "{{ event.name }} ({{ agenda }}) {{ 'begint' if phase == 'start' else 'eindigt' }}"
```

Alleen beheerders stellen acties in. Gebruikers die gebeurtenissen mogen bewerken, zien ze niet, en
hun wijzigingen houden de bestaande acties.

## Zonsopgang, zonsondergang en voorwaarden

De tijden van de zon berekent Home Assistant dag voor dag voor de locatie die is ingesteld onder
Instellingen > Systeem > Algemeen. Als de zon het einde van een gebeurtenis vóór het begin brengt
(zonsondergang na een vast einde om 21:00 in de zomer), vindt de gebeurtenis die dag niet plaats.
Niet voor en Uiterlijk begrenzen een zonnetijd: rolluiken die bij zonsondergang sluiten, maar niet
voor 18:00.

Voorwaarden vergelijken de toestand van een entiteit: `person.alex` is `home`,
`binary_sensor.raam` is niet `on`, `sensor.buitentemperatuur` is onder `5`. Bij meerdere
voorwaarden vraagt de gebeurtenis ze allemaal, of minstens één ervan. Ze worden gelezen bij het
begin van de gebeurtenis en bij elke wijziging van de entiteit. Een gebeurtenis waarvan de
voorwaarden niet meer kloppen, laat het over aan de volgende gebeurtenis, of aan de
standaardtoestand; haar acties aan het einde lopen toch. Een entiteit die onbeschikbaar wordt,
houdt tien minuten haar laatste toestand, ook over een herstart: een sensor die even wegvalt,
verandert niets.

## Afwezigheidsmodus

De knop bovenaan het paneel start hem, tot een datum of tot hij wordt gestopt; de acties
`agenda.set_absence` en `agenda.end_absence` doen hetzelfde vanuit een automatisering. Intussen
houdt elke agenda die hem volgt (een optie in haar instellingen) haar afwezigheidstoestand, of
anders haar standaardtoestand, en voert ze geen actie uit. Aan het einde keert elke agenda terug
naar haar programma.

Een agenda die hem niet volgt, kan in plaats daarvan aanwezigheid nabootsen
(Aanwezigheidssimulatie, in haar instellingen): tijdens een afwezigheid verschuiven haar begin- en
eindtijden willekeurig tot het gekozen aantal minuten, eerder of later, zodat de lampen niet elke
dag op hetzelfde moment aangaan.

## Automatiseringen

| Actie | Doel | Gegevens |
|---|---|---|
| `agenda.skip_next` | de kalender van een agenda | `event` (naam, optioneel): verwijdert de volgende gebeurtenis |
| `agenda.add_dates` | de kalender van een agenda | `event`, `dates`: voegt op deze dagen gebeurtenissen toe |
| `agenda.remove_dates` | de kalender van een agenda | `event`, `dates`: verwijdert de gebeurtenissen op deze dagen |
| `agenda.advance` | de kalender van een agenda | past de volgende wissel meteen toe (Naar de volgende) |
| `agenda.apply_event` | de kalender van een agenda | `event` (naam): past deze gebeurtenis toe tot het einde van haar volgende keer |
| `agenda.resume` | de kalender van een agenda | beëindigt de afwijking en haalt de met de hand ingestelde apparaten terug |
| `agenda.set_absence` | | `until` (optioneel): start de afwezigheidsmodus |
| `agenda.end_absence` | | beëindigt hem |
| `agenda.resync` | de kalender van een agenda | zet de apparaten in de toestand die de agenda nu wil, behalve de met de hand ingestelde |

```yaml
- action: agenda.skip_next
  target:
    entity_id: calendar.agenda_woonkamer
  data:
    event: Ochtend
```

De `calendar`-entiteit van elke agenda werkt ook met de kalendertrigger van Home Assistant, zo
nodig met een verschuiving:

```yaml
triggers:
  - trigger: calendar
    event: start
    entity_id: calendar.agenda_woonkamer
    offset: "-0:15:00"
actions:
  - action: notify.mobile_app_telefoon
    data:
      message: "{{ trigger.calendar_event.summary }} over 15 minuten"
```

## Gebeurtenissen en logboek

Elke toestand die een apparaat krijgt, vuurt `agenda_state_applied` af; een apparaat dat hem na
een tweede poging nog niet toont, vuurt `agenda_state_failed` af en krijgt een probleem onder
Reparaties. Hun gegevens: `agenda`, `entry_id`, `entity_id`, `state`, `label` (de toestand zoals
het paneel hem toont), en bij `agenda_state_applied` de reden `reason` (`schedule`, `edit`,
`resync`, `available`, `retry`...) en de gebeurtenis `event` (`id` en `name`) als een
gebeurtenis hem bepaalde.

```yaml
triggers:
  - trigger: event
    event_type: agenda_state_failed
actions:
  - action: notify.mobile_app_telefoon
    data:
      message: "{{ trigger.event.data.entity_id }} heeft {{ trigger.event.data.label }} niet overgenomen"
```

Het logboek toont een regel voor elke toegepaste toestand ("ingesteld door agenda Slaapkamer:
19 °C"), en de wijzigingen van het apparaat noemen de agenda als oorzaak. Is het logboek op één
apparaat gefilterd, dan houdt Home Assistant alleen de regels van de integratie van dat apparaat:
de oorzaak staat er nog steeds, de regel van de agenda alleen in het volledige logboek.

## Feestdagen

Ze volgen het land dat is ingesteld onder Instellingen > Systeem > Algemeen. Een ander land, of een
regio (een Duitse deelstaat, een Amerikaanse staat...), kies je in de instellingen van een
willekeurige agenda en geldt voor alle agenda's.

In de uitzonderingen van een gebeurtenis staat Feestdagen ook bovenaan de kalenderlijsten. De
instelling Feestdagen beperkt de dagen altijd, een lijst combineert juist haar kalenders: met
Thuiswerk en Feestdagen onder Alleen op dagen met een gebeurtenis (in minstens één ervan, de
standaard) loopt de gebeurtenis op thuiswerkdagen en op feestdagen.

## Schoolvakanties

Voeg een kalender met de schoolvakanties toe, bijvoorbeeld met de integratie Remote Calendar en een
gepubliceerde iCal-kalender van de vakanties van je regio (Noord, Midden of Zuid), en kies hem in de
gedeelde instellingen van een willekeurige agenda.

Een kind dat doordeweeks op een internaat zit, bijvoorbeeld: markeer de doordeweekse gebeurtenissen
als Schoolperiode, en voeg een dagelijkse gebeurtenis van een hele dag toe met de temperatuur voor
thuis, gemarkeerd als Schoolvakantie.

## Dashboardkaart

```yaml
type: custom:agenda-card
view: house                       # alle agenda's, vandaag
agendas: [Slaapkamer, Woonkamer]  # optioneel filter
title: Verwarming                 # optioneel
```

```yaml
type: custom:agenda-card
view: week
agenda: Slaapkamer
hour_height: 32                   # optioneel
```

```yaml
type: custom:agenda-card
view: next                        # resterende tijd, toestand, volgende wissel, Naar de volgende en Hervatten
agenda: Slaapkamer
```

De kaart heeft een visuele editor. Een klik erop opent het paneel.

## Steun

Agenda is gratis. Heb je er iets aan, dan kun je me een koffie trakteren op [Ko-fi](https://ko-fi.com/jolabs40).

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/jolabs40)

Een ster voor deze repository helpt anderen ook om haar te vinden.

## Licentie

[MIT](LICENSE)
