<img src="custom_components/agenda/brand/icon@2x.png" alt="" width="112" align="right">

# Agenda voor Home Assistant

Planning met een kalender voor Home Assistant, naar het voorbeeld van de Agenda-plugin van Jeedom.
Elke kamer of elk apparaat krijgt een eigen agenda, getoond als een week die je bewerkt door
blokken te verslepen.

[![Open je Home Assistant en toon deze repository in de Marktplaats.](https://my.home-assistant.io/badges/marketplace_repository.svg)](https://my.home-assistant.io/redirect/marketplace_repository/?owner=jolabs40&repository=agenda-ha&category=integration)
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
    Een uitgeschakelde gebeurtenis (Gebeurtenis actief, in haar editor) verschijnt bleek en
    doorgestreept, om haar te openen en weer in te schakelen; het blok van een gebeurtenis met
    acties draagt een klein teken.
  - Maand: de gebeurtenissen van elke dag, met feestdagen en schoolvakanties.
  - Huis: alle agenda's over één dag, met wat elk apparaat nu doet en, bij thermostaten, de
    gemeten temperatuur onder de instelwaarde.
  - Lijst: alle gebeurtenissen en hun herhaling.
- Op een breed scherm staan de agenda's in een kolom, zoals in het Kalender-paneel: vink aan welke
  je wilt zien, zie wat elke agenda nu doet en wanneer hij wisselt, pauzeer hem of open zijn
  instellingen. Op een telefoon doen chips bovenaan hetzelfde. De knop Gebeurtenis toevoegen staat
  rechtsonder. Het paneel opent per browser op het laatst gekozen tabblad, en het tandwiel op de
  regel Alle leidt naar de gedeelde instellingen. De rand van de kolom kun je slepen om hem breder
  te maken, en ook dat onthoudt elke browser.
- Dupliceren, in de instellingen van een agenda, maakt er een kopie van: dezelfde instellingen,
  dezelfde gebeurtenissen, zonder de apparaten, die je daarna kiest.
- Andere kalenders van Home Assistant (schoolvakanties, een gezinskalender...) vink je in dezelfde
  kolom aan; ze verschijnen gearceerd in week, maand en huis, alleen ter informatie.
- Een gebeurtenis kan meerdere dagen duren, van de ene datum en tijd tot de andere, herhaald of
  niet. Haar uitzonderingen kijken naar de dag waarop ze begint.
- Een agenda kan haar gebeurtenissen van een hele dag in de week onder de datum tonen, in plaats
  van als blok over de hele kolom: handig voor naamdagen en verjaardagen.
- Herhaling elke N dagen, weken (op gekozen weekdagen, of alleen in even of oneven weken) of
  maanden (op dezelfde datum, op de 2e maandag, op de laatste vrijdag...), eventueel tot een datum.
  Losse dagen kun je uit een reeks halen of eraan toevoegen.
- Het begin of het einde van een gebeurtenis kan de zonsopgang of zonsondergang volgen, met een
  verschuiving, niet voor of uiterlijk op een gekozen tijd.
- Voorwaarden op entiteiten: een gebeurtenis neemt het alleen over zolang er bijvoorbeeld iemand
  thuis is, een raam dicht is of de buitentemperatuur onder 5 °C ligt; allemaal, of minstens één
  ervan.
- Een instelwaarde of een waarde kan een entiteit volgen, bijvoorbeeld een `input_number` of een
  template-sensor: verander die, en elke gebeurtenis die haar volgt, verandert mee. De waarde van de
  gebeurtenis geldt zolang de entiteit er geen heeft.
- De feestdagen van je land kunnen worden overgeslagen, of de enige dagen zijn.
- Kalenders kunnen als voorwaarde dienen: dagen met een gebeurtenis erin overslaan (reizen,
  afwezigheden), alleen die dagen houden, of allebei bij dezelfde gebeurtenis. Bij meerdere
  kalenders volstaat een gebeurtenis in één ervan, of moet er een in elk staan.
  De feestdagen kunnen een van deze kalenders zijn, voor een gebeurtenis die op thuiswerkdagen of
  op feestdagen loopt. Een kalender kan ook alleen zijn gebeurtenissen met een bepaalde tekst
  tellen, zoals de dure dagen van een kalender met stroomtarieven.
  Ook de eigen agenda van de gebeurtenis kan er een van zijn: een herhaalde vrijdag wijkt voor een
  week verlof in dezelfde agenda. Dan tellen alleen de gebeurtenissen die er niet van afhangen.
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
  aanwezigheid nabootsen. Een schakelaar toont hem aan automatiseringen, en de dashboardkaart
  heeft zijn knop.
- Per agenda: een `calendar`-entiteit (Kalender-paneel, kalendertriggers), een schakelaar Actief die
  de agenda pauzeert, de sensoren Nu en Volgende wijziging.
- Acties voor automatiseringen en spraakassistenten: de volgende gebeurtenis overslaan, datums
  toevoegen of verwijderen, van het schema afwijken, de afwezigheidsmodus starten of beëindigen.
- Het logboek noemt de agenda die een apparaat heeft gewijzigd, en twee gebeurtenissen laten
  automatiseringen reageren.
- Gebruikers zonder beheerdersrechten kunnen gebeurtenissen en de afwezigheid mogen bewerken;
  start- en eindacties blijven bij de beheerders.
- Na een herstart worden de gekoppelde apparaten in de toestand gezet die de agenda verwacht (per
  agenda uit te schakelen), behalve de met de hand ingestelde.
- Een dashboardkaart, `custom:agenda-card`, met een visuele editor.
- Op tijd op temperatuur: een thermostaat start zo vroeg als nodig, zodat de kamer bij het begin
  van de gebeurtenis op temperatuur is. Hoe snel de kamer opwarmt, wordt geleerd.
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

Opties van een keuzelijst die een verwarmingsniveau noemen, zoals bij een stuurdraad (Comfort,
Comfort -1, Comfort -2, Eco, Vorstbeveiliging, Uit, ook in het Engels, Frans of Duits), krijgen de
kleur van de modus met dezelfde naam: Comfort oranje, Eco lichtblauw, Vorstbeveiliging blauwgrijs.
Het pictogram van een gebeurtenis kan op Auto blijven: het volgt dan de toestand, een zon voor
Comfort, een maan voor Eco, een sneeuwvlok voor Vorstbeveiliging, een vlam voor een airco die
verwarmt.

| Huisweergave | Gebeurtenis-editor | Telefoon |
|---|---|---|
| ![Huisweergave](docs/house.png) | ![Gebeurtenis-editor](docs/editor.png) | ![Telefoon](docs/mobile.png) |

## Installatie

Zoek Agenda in Instellingen > Marktplaats (Marketplace) of gebruik de knop hierboven, en kies
Installeren. De instelling van een eerste agenda volgt, zonder herstart.

Verschijnt het nog niet, kies dan Voeg toe via link en vul `https://github.com/jolabs40/agenda-ha` in
(daarvoor wordt een verbinding met GitHub gevraagd).

Vóór Home Assistant 2026.11 was de Marktplaats de integratie HACS: zoek Agenda daar, download het en
herstart Home Assistant.

Zonder een van beide `agenda.zip` van de [nieuwste versie](https://github.com/jolabs40/agenda-ha/releases/latest)
uitpakken in een map `custom_components/agenda` van je configuratie (of die map uit de repository
kopiëren) en Home Assistant herstarten.

Na HACS of een handmatige kopie de integratie Agenda toevoegen via Instellingen > Apparaten &
diensten. Elk item is één agenda; meer maak je in het paneel met de knop Nieuwe agenda. Al het andere stel je in het
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

Een thermostaat die zichzelf uitschakelt, is niet met de hand gewijzigd: Versatile Thermostat
schakelt zichzelf uit bij een open raam, door zijn automatisch starten en stoppen of zijn
centrale modus, en onthoudt wat er gevraagd is. De agenda gaat uit van dat verzoek: hij ziet de
stop niet als een wijziging met de hand, en stuurt een Uit dat intussen valt toch.

Afwijkingen veranderen het schema zelf, tot de tijd die ze tonen (`override_until` op de sensor
Nu): Naar de volgende past de toestand van de volgende wissel meteen toe (nog eens: die daarna),
Nu toepassen in de gebeurtenis-editor past de toestand van die gebeurtenis toe tot het einde van
haar volgende keer. Schema hervatten heft beide op en haalt de met de hand ingestelde apparaten
terug.

## Op tijd op temperatuur

Zonder deze instelling krijgt een thermostaat zijn temperatuur bij het begin van de gebeurtenis, en
begint de kamer dan pas op te warmen. Met Op tijd op temperatuur, in de instellingen van een
thermostaatagenda, start hij vroeger zodat de kamer op tijd zover is. Dit geldt voor elke
`climate`-entiteit (radiatorkraan, airco, warmtepomp, Versatile Thermostat), en een airco koelt op
dezelfde manier vroeger. De instelling staat standaard uit.

Bij elke stijging leert de agenda hoe snel de kamer gaat, in °C per uur, en hoe lang het apparaat
nodig heeft om op gang te komen, per thermostaat, verwarmen en koelen apart. Ze heeft drie stijgingen
nodig; tot dan rekent ze op 1,5 °C/u verwarmen, 2,5 °C/u koelen en 10 minuten aanloop. De voorsprong
is die aanloop plus de tijd van de stijging, met 10 % marge, tot de Langste voorsprong (standaard
3 uur, van 15 minuten tot 6 uur). Met meerdere thermostaten op een agenda beslist de traagste en
starten ze allemaal samen.

Een stijging telt niet als iemand het apparaat wijzigt, als het uitgaat of onbereikbaar wordt, als
zijn temperatuur verandert, tijdens een afwezigheid, als ze langer duurt dan twee keer de langste
voorsprong of als het verschil bij het begin hoogstens 0,5 °C is. Een open raam toont zich zo: het
apparaat gaat uit of verandert van temperatuur, of de meting daalt.

Op het berekende tijdstip geldt de hele toestand van de gebeurtenis: temperatuur, modus, ventilatie,
zwenken. Een airco die uit staat, start dus in de juiste modus. Startacties blijven bij het begin.

| Geval | Wat de agenda doet |
|---|---|
| Gebeurtenis met een voorinstelling, alleen een modus, of uit | niets vroeger, er is geen getal om te halen |
| Terug naar een lagere temperatuur bij verwarmen, een hogere bij koelen | niets vroeger |
| Agenda gepauzeerd, afwezigheid, afwijking, apparaat met de hand gewijzigd, voorwaarde onwaar | niets vroeger |
| Een andere gebeurtenis is al begonnen | ze wijkt voor de vroege start |
| Een andere gebeurtenis begint tussen de vroege start en het begin | ze houdt de leiding tot haar einde, de vroege start wacht |
| De schatting daalt zodra de vroege start loopt | hij gaat door |
| De gebeurtenis verdwijnt, haar voorwaarde wordt onwaar, de afwezigheid begint, de agenda wordt gepauzeerd | hij stopt en de agenda gaat terug naar de gewenste toestand |

De meting is die van de thermostaat. De thermometer van een airco of een radiatorkraan wijkt vaak af
van de temperatuur in de kamer: Temperatuursensor van de kamer vervangt die door een sensor, en zonder
waarde van die sensor start niets vroeger. Gaat de meting in het uur na een stijging meestal 0,8 °C of
meer voorbij de ingestelde temperatuur, dan melden de instellingen van de agenda dat: ze komt
waarschijnlijk van dicht bij het apparaat, en de geleerde snelheden zijn te hoog. Buitentemperatuur,
in de gedeelde instellingen, neemt een
sensor of een `weather`-entiteit en corrigeert de geleerde snelheid met hoogstens 30 % naar het weer.

De instellingen van de agenda tonen de geleerde snelheden en een knop om ze te vergeten, net als de
actie `agenda.reset_learning` (op de kalender van de agenda, `climate` voor één thermostaat). De
sensor Opwarmsnelheid geeft de snelheid in °C/u, met `cool_rate`, `dead_time`, `samples` en
`last_sample`. De sensor Volgende wijziging heeft de attributen `preheat_start` en `preheat_minutes`
zodra het tijdstip berekend is. De weergaven Week en Huis tekenen een gearceerde band vóór de
gebeurtenis, en `agenda_state_applied` draagt de reden `preheat` met `preheat_minutes`,
`preheat_start` en `target_time`. Het logboek zegt: "voorverwarmen door agenda Slaapkamer: 20 °C voor
07:00 (begin 05:42)".

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

In de week draagt het blok van een gebeurtenis met acties rechtsonder een klein teken.

## Zonsopgang, zonsondergang en voorwaarden

De tijden van de zon berekent Home Assistant dag voor dag voor de locatie die is ingesteld onder
Instellingen > Systeem > Algemeen. Als de zon het einde van een gebeurtenis vóór het begin brengt
(zonsondergang na een vast einde om 21:00 in de zomer), vindt de gebeurtenis die dag niet plaats.
Niet voor en Uiterlijk begrenzen een zonnetijd: rolluiken die bij zonsondergang sluiten, maar niet
voor 18:00.

Voorwaarden vergelijken de toestand van een entiteit: `person.alex` is `home`, `binary_sensor.raam`
is niet `on`, `sensor.buitentemperatuur` is onder `5`. Bij meerdere voorwaarden vraagt de
gebeurtenis ze allemaal, of minstens één ervan. Ze worden gelezen bij het begin van de gebeurtenis
en bij elke wijziging van de entiteit. Een gebeurtenis waarvan de voorwaarden niet meer kloppen,
laat het over aan de volgende gebeurtenis, of aan de standaardtoestand; haar acties aan het einde
lopen toch. Een gebeurtenis waarvan de voorwaarden bij het begin niet klopten, start noch haar
acties bij het begin, noch die aan het einde. Een entiteit die onbeschikbaar wordt, houdt tien
minuten haar laatste toestand, ook over een herstart: een sensor die even wegvalt, verandert niets.

De week tekent een gebeurtenis waarvan de voorwaarden nu niet kloppen bleek en doorgestreept, zoals
een dag die een agenda weghaalt: met één gebeurtenis per modus op hetzelfde moment verschijnt alleen
die van de huidige modus. Komende dagen worden getekend alsof de voorwaarden hun huidige toestand
houden.

## Een waarde die een entiteit volgt

De instelwaarde van een thermostaat, of de waarde van een Waarde-agenda, kan een entiteit volgen in
plaats van een vast getal: een `input_number`, een `number` of een sensor, zoals een template-sensor
die een waarde per modus geeft. Het apparaat krijgt de waarde van de entiteit bij het begin van de
gebeurtenis en bij elke wijziging, afgerond op zijn stap en binnen zijn grenzen. Het getal dat in de
gebeurtenis is ingesteld, geldt zolang de entiteit er geen heeft; een entiteit die onbeschikbaar
wordt, houdt eerst tien minuten haar laatste waarde.

## Afwezigheidsmodus

De knop bovenaan het paneel of op de dashboardkaart start hem, tot een datum of tot hij wordt
gestopt; de acties
`agenda.set_absence` en `agenda.end_absence` doen hetzelfde vanuit een automatisering. Intussen
houdt elke agenda die hem volgt (een optie in haar instellingen) haar afwezigheidstoestand, of
anders haar standaardtoestand, en voert ze geen actie uit. Aan het einde keert elke agenda terug
naar haar programma.

De schakelaar `switch.agenda_absence` staat aan tijdens een afwezigheid, met het einde in het
attribuut `until` (leeg als ze duurt tot ze wordt gestopt): een automatisering kan erop reageren,
en hem aanzetten start een afwezigheid tot hij wordt uitgezet. Net als in het paneel zijn de
schakelaar en beide acties voorbehouden aan beheerders, tenzij de gedeelde instellingen
gebruikers toestaan gebeurtenissen en de afwezigheid te bewerken; automatiseringen vallen daar
niet onder.

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
| `agenda.reset_learning` | de kalender van een agenda | vergeet de geleerde snelheden, van al zijn thermostaten of van één (`climate`) |
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
`resync`, `available`, `retry`, `preheat`...) en de gebeurtenis `event` (`id` en `name`) als een
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
agendas: [Slaapkamer, Woonkamer]  # optioneel: alleen deze, in deze volgorde
title: Verwarming                 # optioneel
```

```yaml
type: custom:agenda-card
view: week
agenda: Slaapkamer
```

```yaml
type: custom:agenda-card
view: next                        # resterende tijd, toestand, volgende wissel, Naar de volgende en Hervatten
agendas: [Slaapkamer]
```

De kaart heeft een visuele editor. Een klik erop opent het paneel. Elke weergave heeft een knop om
de afwezigheidsmodus te starten of te beëindigen, voor de gebruikers die dat mogen, en tijdens een
afwezigheid een melding.

Alle opties zijn optioneel:

| Optie | Weergave | Effect |
|---|---|---|
| `agendas` | house, next | de getoonde agenda's, in deze volgorde; anders allemaal, op naam |
| `names` | alle | een andere naam in de kaart, bijvoorbeeld `names: {Boiler stel: Stel}` |
| `title`, `icon` | alle | de kop; `title: ""` laat hem weg |
| `absence: false` | alle | geen afwezigheidsknop of melding |
| `tap_action` | alle | wat een klik doet, zoals in de kaarten van Home Assistant; standaard het paneel, `{action: none}` voor niets |
| `start_hour`, `end_hour` | house | de getoonde uren, van 0 tot 24 |
| `name_width`, `row_height` | house | breedte van de namen en hoogte van een rij, in pixels |
| `live: false` | house | zonder de regel onder de naam met wat het apparaat nu doet |
| `curve: false` | house | zonder temperatuurcurve |
| `buttons: false` | next | zonder de knoppen Naar de volgende en Hervatten |
| `days` | week | van 1 tot 7; minder dan 7 begint vandaag |
| `hour_height` | week | hoogte van een uur, in pixels |

## Een probleem melden

In Instellingen > Apparaten & diensten > Agenda biedt het menu van de betreffende agenda Download
diagnostieken: een bestand met de instellingen en gebeurtenissen, de apparaten zoals ze nu zijn, en
de laatste opdrachten die ze kregen met wat elk apparaat toonde. Voeg het toe aan een issue op
[GitHub](https://github.com/jolabs40/agenda-ha/issues), met wat je verwachtte, en wanneer.

Voor meer biedt het menu bovenaan dezelfde pagina Schakel debug-logging in: wacht op het probleem,
dan Schakel debug-logging uit, en Home Assistant downloadt het logboek.

## Steun

Agenda is gratis. Heb je er iets aan, dan kun je me een koffie trakteren op [Ko-fi](https://ko-fi.com/jolabs40).

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/jolabs40)

Een ster voor deze repository helpt anderen ook om haar te vinden.

## Licentie

[MIT](LICENSE)
