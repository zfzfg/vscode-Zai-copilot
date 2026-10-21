# Projektplan: Z.ai-Modellprovider für Visual Studio Code

Projekt: `vscode-zai-copilot`  
Paketname: `zai-copilot-provider`  
Vendor-ID: `zai`  
Planversion: 2.0  
Überarbeitung und Dokumentationsprüfung: 21. Oktober 2026  
Status: umsetzbarer Entwicklungsplan; keine bereits implementierte oder live getestete Extension

> Dieser Plan ersetzt den ursprünglichen Entwurf. Er trennt dokumentierte API-Eigenschaften, bewusst gewählte Projektentscheidungen und noch zu prüfende Annahmen. Insbesondere sind Modellverfügbarkeit, Berechtigungen und Copilot-Oberflächen keine Garantien allein aufgrund einer Provider-Registrierung.

## 1. Ziel und erwartetes Ergebnis

Eine TypeScript-Extension stellt Z.ai-Modelle über die öffentliche `LanguageModelChatProvider`-API im Modellangebot von VS Code bereit. Sie verwaltet Zugangsdaten sicher, übersetzt Nachrichten und Tools in das Z.ai-Chat-Completions-Protokoll und streamt gültige Antworten zurück an VS Code. Die offizielle API beschreibt hierfür Modellinformationen, Antwortbereitstellung und Tokenzählung als die drei Kernaufgaben. [web:5]

Das Ergebnis der ersten freigabefähigen Version ist:

- ein installierbares VSIX für VS Code Desktop;
- ein konfigurierbarer Standard- oder Coding-Plan-Endpunkt;
- ein konservativ gepflegter Modellkatalog mit endpunktabhängiger Filterung;
- stabiler Textchat mit Streaming, Abbruch und verständlichen Fehlermeldungen;
- Tool Calling ausschließlich für tatsächlich getestete Modell-Endpunkt-Kombinationen;
- ein dokumentierter Umgang mit Reasoning-Verlauf ohne ungesicherte chatübergreifende Zuordnung;
- automatisierte Tests, eine Kompatibilitätsmatrix und eine reproduzierbare Paketierung.

### 1.1 Umfang nach Ausbaustufe

| Stufe | Enthalten | Freigabebedingung |
|---|---|---|
| Technischer Spike | Provider registrieren, Modell anzeigen, einfachen Request senden | Build und Laufzeittest auf festgelegter VS-Code-Version |
| MVP Textchat | Schlüsselverwaltung, Endpunkte, Textmapping, SSE, Fehler und Abbruch | Alle Textchat-Abnahmetests bestanden |
| Agent-Beta | Tooldefinitionen, Tool-Call-Streaming, Toolresultate, verifizierte Reasoning-Zuordnung | Vollständiger mehrstufiger Tool-Roundtrip bestanden |
| Version 1.0 | Absicherung, Dokumentation, Paketierung, getestete Plattformen | Alle Release-Gates geschlossen |
| Später | Bilder, erweiterter Katalog, zusätzliche Hosts | Eigene Capability- und Integrationstests |

### 1.2 Bewusste Nichtziele

- Keine eigene Ausführung von Datei-, Terminal-, Browser- oder MCP-Tools.
- Keine zweite Agent-Schleife innerhalb des Providers.
- Keine automatische Umgehung von Copilot-Richtlinien oder Zugriffsvoraussetzungen.
- Keine garantierte Ersetzung von Copilot-Inline-Vervollständigungen per Tab.
- Keine Garantie, dass jede Inline-Chat- oder Edit-Oberfläche jeden Drittanbieterprovider unterstützt.
- Keine Anthropic- oder Responses-Protokollimplementierung im MVP.
- Keine API-Schlüssel in `settings.json`, Quellcode, Logs oder Test-Fixtures.
- Keine automatischen kostenpflichtigen Verbindungstests während der Aktivierung.
- Keine Behauptung, ein fremder Tokenizer liefere exakte GLM-Tokenzahlen.

Ein Chatmodellprovider ist nicht dasselbe wie ein Inline-Completion-Provider. Die konkrete Verfügbarkeit in Chat-, Agent- und Editoroberflächen muss separat geprüft werden. Organisationsadministratoren können BYOK-Modelle über Copilot-Richtlinien deaktivieren. [web:5]

## 2. Konfliktprüfung des ursprünglichen Plans

Die folgenden Änderungen sind verbindlich. Dokumentationsangaben beziehen sich auf den Prüfstand dieses Plans und müssen vor einem Release erneut geprüft werden.

| ID | Konflikt oder Lücke | Risiko | Korrektur |
|---|---|---|---|
| K01 | `glm-5.3` wird als Vision-Modell beschrieben | Nicht unterstützte Bildrequests und falsche Picker-Metadaten | GLM-5.3 als text-only behandeln. [web:6] |
| K02 | Alle vier Modelle erhalten pauschal 128K Input und Output | Falsches Kontextmanagement | 5.3-Dokumentation nennt 1M Kontext und 128K maximalen Output; gemeinsame Budgetierung separat umsetzen. [web:6][web:3] |
| K03 | Tabelle nennt 128K Output, Beispielcode nur 16.384 | Unklare Bedeutung von Fähigkeit und Projektlimit | Anbieterlimit, veröffentlichtes Providerlimit und Requestbudget getrennt speichern |
| K04 | Thinking soll für FlashX abschaltbar sein | Ungültige Requests | 5.3, Flash und FlashX erzwingen Thinking; für geringere Reasoning-Tiefe `reasoning_effort: low` verwenden, ohne Latenzgarantie. [web:6][web:3] |
| K05 | FlashX wird auch für den Coding Plan eingeplant | Modell nicht verfügbar | FlashX im Coding-Plan-Profil zunächst ausblenden. Die Modellseite schließt es dort aktuell aus. [web:3] |
| K06 | Alle Modelle gelten auf beiden Endpunkten als verfügbar | Fehler, Quotenprobleme, falsche Erwartungen | Verfügbarkeit pro Profil führen; Dokumentation und kontobezogenen Smoke-Test unterscheiden |
| K07 | Provider verwendet Consumer-Nachrichtentypen | Typ- und Laufzeitfehler | Provider-Eingang ist `LanguageModelChatRequestMessage`, Tokenzählung akzeptiert auch diesen Typ. [web:5] |
| K08 | Rollen `User`, `Assistant`, `System` werden pauschal vorausgesetzt | Erfundene oder nicht verfügbare Enum-Felder | Rollen anhand der gepinnten stabilen Typdefinitionen vollständig behandeln; keine `System`-Konstante voraussetzen |
| K09 | Systemnachrichten werden zu Usernachrichten umgeschrieben | Bedeutungsänderung, schwächere Instruktionstrennung | Rollen niemals still verändern; ungültigen Verlauf ablehnen oder separat geprüften Adapter verwenden |
| K10 | Dummy-User-Nachricht als Standardreparatur | Erfundenes Nutzeranliegen | Kein Dummy im regulären Pfad |
| K11 | `Map<MessageHash, Reasoning>` genügt | Vermischung gleicher Antworten, Verzweigungen und paralleler Chats | Requestlokale Accumulatoren und streng geprüfte Verlaufszuordnung; keine Garantie ohne belastbare Identität |
| K12 | Jeder Netzwerkchunk oder jede `data:`-Zeile ist ein vollständiges SSE-Event | JSON-/Unicode-Fehler und verlorene Inhalte | Inkrementellen UTF-8-, Zeilen- und Eventparser einsetzen |
| K13 | Tool-Calls werden bei beliebigem Streamende veröffentlicht | Ausführung unvollständiger oder beschädigter Argumente | Nur nach validiertem semantischem Abschluss und vollständigem Batch veröffentlichen |
| K14 | `toolCalling: true` garantiert Agent-Modus | Unhaltbare Produktzusage | Notwendige Capability, aber keine ausreichende Integrationsgarantie |
| K15 | Mehrere Tools und `tool_choice` bleiben unberücksichtigt | Geändertes Host-Verhalten | Tool-Limit, Namensmapping und Wahlbeschränkungen explizit behandeln |
| K16 | 401 öffnet sofort einen Eingabedialog | Popup-Schleifen und Hintergrundinteraktion | Im Requestpfad Fehler mit Konfigurationshinweis; Schlüsseländerung nur bewusst auslösen |
| K17 | Retry-Regeln fehlen | Doppelte Kosten, doppelte Antworten oder Aktionen | Kein automatisches Replay nach gesendetem Request im MVP |
| K18 | `^1.105.0` wird ohne Test als Mindestversion übernommen | Installation in inkompatible Hosts | Mindestversion durch Compile-, Manifest- und Laufzeitprüfung bestimmen |
| K19 | Sprachheader wird als notwendig dargestellt | Unnötige Kopplung | `Accept-Language` ist optional; `en-US,en` ist dokumentierter Default. [web:4] |
| K20 | Leeres Tool-Schema darf beliebig weggelassen werden | Vertragsverletzung | Valides Objekt-Schema senden; die aktuelle Referenz verlangt `parameters`. [web:4] |

Die Z.ai-Referenz enthält selbst Unterschiede zwischen allgemeinen Schemas und konkreten Modellseiten: etwa generische Thinking-Enums mit `disabled`, obwohl 5.3-Modelle dies nicht unterstützen, sowie unvollständige Vision-/Tool-Schemafelder. Im Projekt gewinnt eine konkrete Modellbeschränkung vor einer generischen Optionsliste; strittige Kombinationen werden durch einen aufgezeichneten Integrationstest freigegeben. [web:4][web:6][web:3]

## 3. Evidenz, Annahmen und Freigaberegeln

Jede Modelleigenschaft erhält einen Status:

- `documented`: offizielle Dokumentation bestätigt die Eigenschaft.
- `verified`: zusätzlich wurde genau diese Kombination aus Modell, Endpoint und Requestform getestet.
- `experimental`: manuell aktivierbar, aber nicht als reguläre Fähigkeit beworben.
- `unsupported`: laut Dokumentation nicht unterstützt oder im Projekt bewusst ausgeschlossen.

Ein erfolgreicher Textrequest beweist weder Tool Calling noch Bilder noch ausreichend Kontingent für Agent-Schleifen. Ein gültiger Schlüssel beweist keine Berechtigung für alle Modelle.

Für jeden Live-Test erfassen:

- Testdatum, Extension-Commit und VS-Code-Version;
- genaue Modell-ID und Endpointprofil;
- getestete Fähigkeit und erwartetes Ergebnis;
- redigierten HTTP-Status und Anbieterfehlercode;
- keine Schlüssel, Prompts, Quellcodes oder Reasoning-Inhalte.

Dokumentationsprüfung ersetzt keine Live-Verifikation. Dieser Plan enthält keine Behauptung, solche Live-Tests seien bereits durchgeführt worden.

## 4. Z.ai-Protokoll und Modellkatalog

### 4.1 Unterstützte Endpunkte

| Profil | Base URL | Vollständiger Requestpfad |
|---|---|---|
| `standard` | `https://api.z.ai/api/paas/v4` | `/chat/completions` |
| `coding-plan` | `https://api.z.ai/api/coding/paas/v4` | `/chat/completions` |

Die allgemeine API und die Coding-Plan-Anleitung dokumentieren diese unterschiedlichen Base URLs. Die Nutzung des Coding Plans ist an die jeweils geltenden unterstützten Werkzeuge und Vertragsbedingungen gebunden; daraus folgt keine pauschale Freigabe jeder eigenen Integration. [web:7][web:19]

Entscheidungen:

1. Beide URLs liegen in einer zentralen Allowlist.
2. Der Konfigurator verlangt eine bewusste Profilwahl; ohne Wahl bleibt der Provider unkonfiguriert.
3. Kein automatisches Umschalten bei 401, 403, 404 oder 429.
4. Kein automatischer Wechsel auf Standardabrechnung bei ausgeschöpftem Coding Plan.
5. Pro Profil eigener SecretStorage-Eintrag; derselbe Schlüssel darf nur nach bewusster Eingabe für beide Profile gespeichert werden.
6. Benutzerdefinierte URLs und Weiterleitungen sind im MVP ausgeschlossen.
7. URL-Konstruktion erhält `/api/.../v4`; ein führender relativer Pfad darf diese Segmente nicht versehentlich ersetzen.
8. Modellseiten zeigen teilweise abweichende Endpointübersichten und Standard-API-Beispiele. Daher keine heuristische Umleitung aus einer einzelnen Modellseite ableiten. [web:6]

### 4.2 Header und Requestform

```http
POST <baseUrl>/chat/completions
Authorization: Bearer <secret>
Content-Type: application/json
Accept: text/event-stream
```

Optional: `Accept-Language: en-US,en`. Bearer-Authentifizierung, JSON-Requests und SSE-Streaming sind dokumentiert. [web:7][web:4]

Bei `fetch` ist `redirect: 'error'` vorzusehen. Antworten mit unerwarteten Statuscodes, Content-Types oder fehlendem Body nicht blind als SSE interpretieren.

### 4.3 Modellmatrix

| Modell | Eingaben laut Dokumentation | Kontext / max. Output | Thinking | Endpointregel im Projekt |
|---|---|---|---|---|
| `glm-5.3` | Text | 1M / 128K | Nicht abschaltbar; `low`, `high`, `max` | Standard und Coding Plan als getrennte Prüfprofile |
| `glm-5.3-flash` | Unter anderem Text und Bilder | 1M / 128K | Nicht abschaltbar | Beide Profile getrennt testen |
| `glm-5.3-flashx` | Unter anderem Text und Bilder | 1M / 128K | Nicht abschaltbar | Standard; Coding Plan aktuell ausgeschlossen |
| `glm-5.2` | Text im hier verwendeten Text-API-Schema | Kontext hier nicht abschließend bestätigt; API nennt bis 131.072 Output | Modellabhängige ältere Thinking-Regeln | Optional; bis zur eigenen Prüfung nicht regulär veröffentlichen |

Die Angaben zur 5.3-Serie stammen aus den jeweiligen Modellseiten. Die gemeinsame API-Referenz nennt GLM-5.2 im Textschema und einen maximalen Output von 131.072 Tokens. Für GLM-5.2 wird bewusst kein ungeprüftes Kontextlimit übernommen. [web:6][web:3][web:4]

`1M` wird nicht ungeprüft als exakt 1.048.576 Tokens interpretiert. Projektstartwert für die geprüfte 5.3-Serie ist ein konservatives Kontextbudget von 1.000.000 Tokens; das ist eine Projektgrenze, kein Nachweis der exakten Anbieterzählung.

### 4.4 Fähigkeiten nur so weit veröffentlichen wie implementiert

- Text-MVP: `imageInput: false`, auch bei grundsätzlich bildfähigen Modellen.
- Text-MVP: `toolCalling: false`, solange der komplette Roundtrip nicht bestanden wurde.
- Agent-Beta: Tool Calling je geprüfter Kombination freigeben; die aktuelle VS-Code-Dokumentation erlaubt dafür `boolean | number`, sodass bei passender Zielversion ein bestätigtes Mengenlimit ausgedrückt werden kann. [web:5]
- Bilder erst aktivieren, wenn VS-Code-Eingabetypen, MIME-Prüfung, Größenlimits und Z.ai-Mapping gemeinsam getestet sind.
- Nicht aus dem Namen `flash` oder `flashx` auf Protokollparameter schließen.
- Modellwechsel innerhalb einer Unterhaltung entwertet ungesichert zugeordnete Reasoning-Metadaten.

### 4.5 Modellbeschreibung im Code

```typescript
type EndpointProfile = 'standard' | 'coding-plan';
type Verification = 'documented' | 'verified' | 'experimental' | 'unsupported';

interface ModelDescriptor {
  apiModelId: string;
  displayName: string;
  family: string;
  version: string;
  providerContextBudget: number;
  providerMaxOutputTokens: number;
  defaultRequestMaxOutputTokens: number;
  inputSafetyMarginTokens: number;
  supportsThinkingDisable: boolean;
  reasoningEfforts: readonly string[];
  endpointStatus: Record<EndpointProfile, Verification>;
  implementedCapabilities: {
    text: boolean;
    tools: boolean;
    images: boolean;
  };
}
```

Die Struktur ist ein eigener Architekturvertrag, keine Kopie eines VS-Code-Interfaces. Eine getrennte Funktion konvertiert sie in die tatsächlich verfügbaren VS-Code-Typen. Modell-ID, Modellfamilie und Extension-Version dürfen nicht verwechselt werden.

## 5. Architektur und Zuständigkeiten

### 5.1 Verzeichnisstruktur

```text
vscode-zai-copilot/
├── src/
│   ├── extension.ts
│   ├── provider/
│   │   ├── zaiProvider.ts
│   │   ├── modelCatalog.ts
│   │   └── vscodeAdapter.ts
│   ├── config/
│   │   ├── configuration.ts
│   │   └── endpointProfiles.ts
│   ├── auth/
│   │   ├── secretStore.ts
│   │   └── managementCommands.ts
│   ├── protocol/
│   │   ├── types.ts
│   │   ├── requestBuilder.ts
│   │   ├── messageMapper.ts
│   │   ├── toolMapper.ts
│   │   ├── streamDecoder.ts
│   │   └── toolCallAccumulator.ts
│   ├── transport/
│   │   ├── httpClient.ts
│   │   ├── timeouts.ts
│   │   └── errors.ts
│   ├── reasoning/
│   │   ├── replayStore.ts
│   │   └── historyMatcher.ts
│   ├── tokens/
│   │   └── tokenEstimator.ts
│   └── diagnostics/
│       ├── logger.ts
│       └── diagnosticsCommand.ts
├── test/
│   ├── unit/
│   ├── integration/
│   ├── extension-host/
│   └── fixtures/
├── docs/
│   ├── COMPATIBILITY.md
│   ├── PRIVACY.md
│   └── TROUBLESHOOTING.md
├── .vscode/
│   ├── launch.json
│   └── tasks.json
├── package.json
├── package-lock.json
├── tsconfig.json
├── eslint.config.mjs
├── .vscodeignore
├── README.md
├── CHANGELOG.md
└── LICENSE
```

### 5.2 Abhängigkeitsrichtung

```text
VS Code Host
  → Provider / VS-Code-Adapter
  → RequestBuilder + Mapper + Budgetprüfung
  → HTTP-Client
  → SSE-Decoder + Tool-Accumulator
  → Provider-Fortschrittsausgabe
```

- Der HTTP-Client kennt kein VS-Code-UI.
- Mapper, Parser, Budgetlogik und Historienvergleich sind möglichst reine Funktionen.
- Nur der äußere Adapter erzeugt `LanguageModelTextPart` und `LanguageModelToolCallPart`.
- Der Provider löst keine `executeCommand`-, Shell- oder Dateischreibaktionen aus, die ein Modell vorgeschlagen hat.
- Konfiguration und Zugangsdaten werden am Requestbeginn als unveränderlicher Snapshot erfasst.
- Jeder Request besitzt eigene Decoder, Accumulatoren, Timer und Abbruchsteuerung.
- Geteilter Zustand ist nur für bewusst begrenzte Katalog-, Auth- und Replay-Daten erlaubt.

### 5.3 Request-Lebenszyklus

1. Bereits gesetztes CancellationToken prüfen.
2. Modell, Profil und Host-Fähigkeiten validieren.
3. Aktuellen Konfigurations- und Credential-Snapshot lesen.
4. Nachrichten und Tools strukturerhaltend abbilden.
5. Erforderliche Reasoning-Historie eindeutig zuordnen oder vor dem Versand abbrechen.
6. Tokenbudget und Größenlimits prüfen.
7. Request mit gekoppeltem AbortSignal absenden.
8. HTTP-Status und Streamformat prüfen.
9. Text fortlaufend berichten, Tools zunächst vollständig sammeln.
10. Abschlussgrund und alle Tool-Calls validieren.
11. Vollständigen Replay-Eintrag vor der ersten Tool-Veröffentlichung atomar vormerken.
12. Nur gültige Tool-Calls an den Host melden.
13. Bei Fehler/Abbruch Replay-Eintrag gegebenenfalls zurücknehmen; keine unvollständigen Calls melden.
14. Reader, Timer, Listener und Requestregistrierung in `finally` aufräumen.

## 6. VS-Code-Vertrag und Versionsstrategie

### 6.1 Mindestversion nicht raten

Die ursprüngliche Mindestversion `^1.105.0` ist eine unbestätigte Annahme. Die neue Mindestversion wird in Phase 0 festgelegt:

1. Öffentliche stabile Provider-API und Manifest-Contribution in einer konkreten VS-Code-Version prüfen.
2. Passende `@types/vscode`-Version exakt pinnen.
3. Minimalprovider mit `tsc --noEmit` kompilieren.
4. Manifest und Aktivierung im zugehörigen Extension Development Host prüfen.
5. Modellabfrage und einen Mock-Request durch den Host durchführen.
6. Erst danach `engines.vscode` setzen.

Keine Proposed APIs und kein `as any`, um Kompatibilitätsprobleme zu verdecken. Dokumentationsbeispiele dürfen ältere stabile Versionen nicht stillschweigend als kompatibel erscheinen lassen.

### 6.2 Provider-Signaturen

Der aktuelle offizielle Guide beschreibt insbesondere folgende Parametertypen: [web:5]

```typescript
provideLanguageModelChatInformation(options, token)
provideLanguageModelChatResponse(model, messages, options, progress, token)
provideTokenCount(model, textOrMessage, token)
```

Wichtige Typregeln:

- `messages` besteht providerseitig aus `readonly LanguageModelChatRequestMessage[]`.
- `provideTokenCount` muss `string | LanguageModelChatRequestMessage` verarbeiten.
- Inhaltsteile können unbekannt sein; exhaustive Prüfungen und verständliche Fehler vorsehen.
- Toolresultate sind strukturelle Inhaltsteile und nicht einfach eine zusätzliche Host-Rolle `tool`.
- Eine Systemrolle nur dann behandeln, wenn die gepinnte API sie tatsächlich bereitstellt.
- Verfügbare Tools, Modellauswahloptionen und mögliche Wahlbeschränkungen anhand der Zieltypen auswerten.

### 6.3 Registrierung und Aktivierung

Die Vendor-ID muss im Manifest und bei `vscode.lm.registerLanguageModelChatProvider('zai', provider)` identisch sein. Der Management-Command muss sowohl unter `contributes.commands` stehen als auch registriert werden. [web:5]

Alle Registrierungen und EventListener in `context.subscriptions` aufnehmen. Zusätzliche Aktivierungsereignisse nur setzen, wenn sie in der Zielversion gültig und nötig sind; kein breites `*` als Ersatz für ungeklärte Provider-Aktivierung.

### 6.4 Modellabfrage und Refresh

- `silent: true`: niemals Dialoge öffnen, kostenpflichtige Requests starten oder Schlüsseltests ausführen.
- Konfigurierter Provider: Katalog aus lokalen Metadaten liefern.
- Nicht konfigurierter Provider: leere Modellliste liefern; Konfiguration bleibt per Command erreichbar.
- `silent: false`: höchstens einen expliziten Setup-Dialog anbieten, keine Schleife.
- Abgebrochene Eingabe verändert bestehende Schlüssel nicht.
- Schlüsseländerung, Profilwechsel und Capability-Änderung lösen einen Refresh aus, soweit die stabile Ziel-API dafür einen dokumentierten Mechanismus bietet.
- Existiert in der Zielversion kein geeigneter öffentlicher Mechanismus, einen erforderlichen Fensterreload dokumentieren; keine privaten Commands verwenden.

## 7. Konfiguration, Authentifizierung und Migration

### 7.1 Einstellungen

Alle abrechnungs-, endpoint- und sicherheitsrelevanten Settings erhalten im Manifest `scope: application`, soweit für die Zielversion unterstützt. Ein Repository darf dadurch keine Daten an einen anderen Endpoint umlenken.

| Einstellung | Typ / Startwert | Verhalten |
|---|---|---|
| `zai.endpointProfile` | `unconfigured`, `standard`, `coding-plan`; initial `unconfigured` | Bewusste Auswahl vor erster Anfrage |
| `zai.reasoningEffort` | `low`, `high`, `max`; initial `high` | Projektdefault, kein Anbieterdefault |
| `zai.maxOutputTokens` | Integer; initial 16.384 | Gemeinsame Obergrenze für sichtbare Ausgabe und modellabhängiges Reasoning-Budget prüfen |
| `zai.preservedThinking` | `off`, `experimental-strict`; initial `off` | Historisches Replay nur mit geprüfter Zuordnung |
| `zai.timeouts.firstEventMs` | Integer; initial 180.000 | Wartezeit bis zum ersten dekodierten Anbieterereignis |
| `zai.timeouts.idleMs` | Integer; initial 120.000 | Inaktivität nach erster gültiger Antwortaktivität |
| `zai.timeouts.totalMs` | Integer; initial 900.000 | Gesamtdauer einschließlich Thinking |
| `zai.logLevel` | `error`, `warn`, `info`, `debug`; initial `warn` | Ausschließlich redigierte technische Metadaten |
| `zai.experimentalModels` | Boolean; initial `false` | Nicht regulär verifizierte Einträge sichtbar machen |

Timeoutwerte sind konfigurierbare Projektstartwerte, keine bestätigten Z.ai-SLAs. Reasoning kann stattfinden, bevor sichtbarer Text erscheint. `low` reduziert die angeforderte Reasoning-Tiefe, garantiert aber keine bestimmte Time-to-First-Token.

### 7.2 Commands

- `zai.manageProvider`: Profil, Schlüsselstatus, ändern, löschen.
- `zai.testConnection`: bewusster, möglicherweise kostenpflichtiger Minimalrequest; vor Versand Modell und Profil anzeigen.
- `zai.clearReasoningCache`: alle im Speicher gehaltenen Replay-Daten löschen.
- `zai.showDiagnostics`: redigierte lokale Diagnosedaten öffnen.

Ein Verbindungstest muss zeigen, ob nur Textchat oder zusätzlich ein Tool-Roundtrip getestet wurde. Kein pauschales grünes „alles unterstützt“ nach einer einzigen Antwort.

### 7.3 SecretStorage

Vorgeschlagene Einträge:

```text
zai.apiKey.standard
zai.apiKey.coding-plan
```

Schlüssel über `context.secrets` speichern und lesen. Die Plattform stellt dafür SecretStorage bereit; keine eigene Klartextdatei oder selbst gebaute Verschlüsselung hinzufügen. [web:18]

Regeln:

- Eingabe mit `password: true`, nicht in Prompts oder Fehlermeldungen spiegeln.
- Nur äußere versehentliche Leerzeichen entfernen; keine unbestätigte Schlüsselregex erzwingen.
- Niemals Schlüssel auslesen, um sie später vollständig anzuzeigen.
- Löschen entfernt ausschließlich das gewählte Profilsecret und zugehörige Replay-Daten.
- Rotation erhöht eine interne Credential-Generation, damit alte Replay-Einträge ungültig werden.
- Aktive Requests verwenden ihren Snapshot; beim Löschen des verwendeten Secrets laufende Requests dieses Profils abbrechen.
- Bei gleicherzeitigen Setup-Aufrufen nur einen Dialog zulassen.
- SecretStorage-Verfügbarkeit im tatsächlich verwendeten lokalen oder entfernten Extension Host testen.

### 7.4 Migration vom ursprünglichen Entwurf

Wenn bereits eine Vorversion mit alten Settings existiert:

1. `zai.useCodingPlanEndpoint` in das neue Profil übersetzen, aber einen neu erkannten Standardbetrieb sichtbar bestätigen lassen.
2. Altes Secret `zai.apiKey` nur einem bewusst bestätigten Profil zuordnen; nicht still kopieren.
3. `zai.enableThinking=false` oder `zai.disableThinkingForFlashX=true` nicht in ungültige 5.3-Payloads übernehmen.
4. Eine einmalige Migrationsinformation erläutert, dass 5.3 Thinking erzwingt und `low` die passende reduzierte Stufe ist.
5. Erst nach erfolgreichem Speichern und ausdrücklicher Entscheidung alte Secrets entfernen.
6. Migration idempotent ausführen und testen.

## 8. Nachrichtenmapping und Kontexttreue

### 8.1 Verbindliche Invarianten

1. Reihenfolge der Nachrichten beibehalten.
2. Reihenfolge bedeutungstragender Inhaltsteile beibehalten.
3. Rollen nicht zur Fehlervermeidung verändern.
4. Toolresultate immer der ursprünglichen `tool_call_id` zuordnen.
5. Daten aus Toolausgaben niemals zu Systeminstruktionen hochstufen.
6. Unbekannte oder nicht abbildbare Teile nicht still verwerfen.
7. Keine Platzhalter wie `[object Object]` oder erfundene Nutzertexte senden.
8. Validierung beendet ungeeignete Requests vor dem Netzwerkzugriff.

### 8.2 Abbildungstabelle

| Hostinhalt | Z.ai-Abbildung | Prüfung |
|---|---|---|
| User mit Text | `role: user`, Text oder unterstützte Textblöcke | Reihenfolge und Inhalt |
| Assistant mit Text | `role: assistant`, sichtbarer Text | Reasoning getrennt halten |
| Assistant mit Tool-Calls | `role: assistant`, `tool_calls` | IDs, Namen und serialisierbare Argumente |
| Host-Toolresultat | eigene `role: tool`-Nachricht | Passende frühere Call-ID |
| Bildinhalt | später `image_url`-Block | Modell, MIME, Größe und Hosttyp |
| Unbekannter Inhaltsteil | Fehler `UNSUPPORTED_MESSAGE_PART` | Keine stille Auslassung |

Ein einzelnes Host-Message-Objekt kann in mehrere API-Nachrichten zerlegt werden, beispielsweise bei mehreren Toolresultaten. Zusammenhängenden Text nicht so zusammenziehen, dass zwischenliegende Toolresultate oder Rollen verschwinden.

### 8.3 Ungültige Verläufe

Die Z.ai-Referenz untersagt Eingaben, die ausschließlich aus System- oder Assistant-Nachrichten bestehen. [web:4]

Standardverhalten:

- Leeres Array: vor dem Versand ablehnen.
- Ausschließlich Assistant/System: mit erklärbarem Mappingfehler ablehnen.
- Toolresultat ohne zugehörigen Call: als unvollständigen Verlauf ablehnen.
- Vom Host abgeschnittene Toolsequenz: nicht selbst erfinden oder ergänzen.
- Neue Host-Rollen: nicht über einen `default`-Zweig versehentlich als Assistant behandeln.

Ein späterer Kompatibilitätsadapter ist nur für ein reproduziertes Host-Szenario zulässig, mit eigener Dokumentation und Tests. Er gehört nicht in den generischen Mapper.

### 8.4 Multimodale Daten

Bildunterstützung ist ein gesonderter Meilenstein. Flash und FlashX dokumentieren URL- und Base64-Data-URL-Eingaben über `image_url.url`. [web:3]

Der Ausbau muss prüfen:

- tatsächlich vom Host übergebene Bild-/Datenteiltypen;
- erlaubte MIME-Typen, Dateigröße und Pixelgrenzen für das jeweilige Modell;
- Reihenfolge von Text und Bildern;
- aus Byte-Arrays erzeugte Data-URLs ohne unbeabsichtigte UTF-8-Konvertierung;
- keine eigenständigen Downloads beliebiger Bild-URLs durch die Extension;
- keine lokale Datei ohne passenden Hostinhalt oder bewusste Nutzeraktion lesen;
- kein Bild in Logs, Diagnoseexporten oder Replay-Hashes unnötig vervielfältigen;
- Inputbudget auch für Bilder berücksichtigen oder die Kombination vorläufig sperren.

## 9. Tool Calling und Agent-Integration

### 9.1 Verantwortungsgrenze

```text
VS Code stellt zulässige Tools bereit
→ Provider übersetzt die Tooldefinitionen
→ Z.ai erzeugt Tool-Calls
→ Provider validiert und meldet vollständige Calls
→ VS Code entscheidet über Zustimmung und Ausführung
→ VS Code liefert Toolresultate im nächsten Request
→ Provider übersetzt den nächsten Request
```

Die Extension führt keine Modellfunktion selbst aus. Dadurch bleiben Bestätigung, Workspace Trust und die eigentliche Toolausführung beim Host.

### 9.2 Definitionen und Schema

Die API dokumentiert bis zu 128 Funktionen und Namen aus Buchstaben, Zahlen, Unterstrich oder Bindestrich mit maximal 64 Zeichen. Das aktuelle Funktionsschema verlangt unter anderem Name, Beschreibung und Parameter. [web:4]

Vor dem Versand:

1. Anzahl prüfen, nicht still auf 128 kürzen.
2. Fehlendes Schema durch `{ "type": "object", "properties": {} }` ersetzen.
3. Vorhandene Schemas nicht durch dieses leere Schema überschreiben.
4. JSON-Serialisierbarkeit und Schemaform prüfen.
5. Nicht unterstützte Schemaelemente mit genauer Ursache ablehnen; nicht bedeutungsverändernd entfernen.
6. Fehlende Beschreibung nur durch eine dokumentierte, neutrale Kennzeichnung ersetzen, nicht durch erfundene Fähigkeiten.
7. Doppelte Toolnamen erkennen.
8. Toolnamen, die Anbietergrenzen verletzen, über eine deterministische, kollisionsgeprüfte bidirektionale Zuordnung übersetzen oder explizit ablehnen.
9. Namenszuordnung für historische Calls rekonstruierbar und unveränderlich halten; nicht anhand zufälliger Reihenfolge neu erzeugen.

### 9.3 Toolwahl

Die geprüfte Chat-Completions-Referenz dokumentiert `tool_choice: auto`, nicht pauschal alle OpenAI-Varianten. [web:4]

Daher:

- `auto`: regulär verwenden.
- Keine Tools erlaubt: Toolliste weglassen und keine Calls akzeptieren.
- Bestimmtes Tool oder zwingender Toolaufruf: nur dann als unterstützt anbieten, wenn die Ziel-Hostoption verlustfrei abbildbar ist.
- Nicht abbildbare Pflichtwahl nicht still zu `auto` abschwächen.
- Wenn der Host eine nicht unterstützte Anforderung zwingend stellt, vor dem Versand abbrechen und diese Agent-Kombination nicht freigeben.

### 9.4 Tool-Call-Accumulator

Schlüssel: `(choice.index, tool_call.index)`.

Gesammelte Daten:

- Call-ID;
- Funktionsname;
- unveränderte Argumentfragmente als Stringfolge;
- Herkunft und Reihenfolge;
- Byteanzahl;
- Abschlussstatus.

Regeln:

- Im MVP genau eine Choice verarbeiten; unerwartete weitere Choices ablehnen.
- Argumentfragmente in Empfangsreihenfolge zusammensetzen.
- Namen/IDs nach dem getesteten Streamformat behandeln: erstmalig setzen, identische Wiederholungen erlauben, bestätigte Fragmente anhängen; widersprüchliche Wiederholungen ablehnen.
- Namen nicht blind immer aneinanderhängen, wenn ein Backend denselben vollständigen Namen wiederholt.
- Falls Fragment- und Wiederholungsformat nicht eindeutig unterscheidbar sind, nur die konkret geprüfte Anbieterform unterstützen.
- `tool_stream: true` nur bei bestätigter Unterstützung setzen; allgemeine Referenz und Flash-Seite unterscheiden sich im Detailgrad. [web:4][web:3]
- Nicht auf Byte-Ebene JSON parsen.
- Genau einmal nach vollständig bestätigtem Abschluss `JSON.parse` aufrufen.
- Keine JSON-Reparatur, keine Codeblöcke entfernen, kein Ergänzen fehlender Klammern.
- Ergebnis muss zum erwarteten Argumenttyp passen, bei Funktionstools regulär ein Objekt.
- Name muss nach Rückabbildung in den vom Host erlaubten Tools vorkommen.
- Alle Calls eines Antwortbatches validieren, bevor der erste Call gemeldet wird.

### 9.5 Abschluss und Fehlerfälle

Ein Toolbatch wird nur veröffentlicht, wenn:

1. ein zur Toolausgabe passender Abschlussgrund vorliegt;
2. die Antwort im definierten Transportvertrag vollständig abgeschlossen ist;
3. IDs und Argumente vollständig und eindeutig sind;
4. der gesamte Batch validiert wurde;
5. kein Abbruch, Timeout oder Streamfehler vorliegt;
6. erforderliche Replay-Daten sicher vorliegen.

Bei `length`, `sensitive`, Kontextüberschreitung oder Netzwerkfehler keine gesammelten Calls ausführen lassen. Solche Abschlussgründe sind in der API dokumentiert. [web:4]

Der Fortschrittskanal ist nicht transaktional: Ein bereits gemeldeter Call lässt sich nicht zuverlässig zurücknehmen. Deshalb erfolgt die Batchvalidierung vor der Veröffentlichung. Bei Abbruch während der Veröffentlichung kann trotzdem ein Teil gemeldet worden sein; nie automatisch wiederholen und den Hostzustand nicht eigenmächtig „reparieren“.

## 10. Thinking und belastbares Reasoning-Replay

### 10.1 Drei getrennte Konzepte

1. Aktuelles Thinking: Rechenmodus der aktuellen Antwort.
2. Interleaved Thinking: Reasoning zwischen Toolaufrufen.
3. Preserved Thinking: zusätzliche Wiederverwendung historischer Reasoning-Blöcke über Antwortturns hinweg.

Die Z.ai-Dokumentation fordert für Interleaved Thinking die Rückgabe von Thinking-Blöcken mit den Toolresultaten. Preserved Thinking verlangt vollständige, unveränderte und korrekt geordnete historische `reasoning_content`-Blöcke. Es ist laut Capability-Seite am Coding-Plan-Endpunkt standardmäßig aktiv und am Standardendpunkt standardmäßig deaktiviert. [web:17]

### 10.2 Requestpolitik

Für die 5.3-Serie:

```json
{
  "thinking": {
    "type": "enabled",
    "clear_thinking": true
  },
  "reasoning_effort": "high"
}
```

`high` ist hier ein Projektdefault. Der Anbieter dokumentiert für GLM-5.3 standardmäßig `max`; `disabled` ist für diese Serie ungültig. [web:6]

`clear_thinking: true` deaktiviert weder das aktuelle Reasoning noch ersetzt es notwendige Reasoning-Rückgabe für Toolfortsetzungen. Es steuert die Behandlung früherer Thinking-Blöcke. [web:4][web:17]

Politik:

- Text-MVP setzt `clear_thinking: true` explizit, um nicht von Endpointdefaults abhängig zu sein.
- Agent-Beta implementiert zusätzlich exaktes Replay für die konkrete Toolfortsetzung.
- Historisches Preserved Thinking über weitere normale Turns bleibt zunächst `off`.
- `experimental-strict` setzt `clear_thinking: false` nur bei vollständig belegter und eindeutig zugeordneter Historie.
- Kann eine erforderliche Toolfortsetzung nicht sicher rekonstruiert werden, vor dem Request abbrechen; nicht still Reasoning erfinden, kürzen oder aus einem anderen Chat übernehmen.

### 10.3 Warum ein einfacher Message-Hash nicht ausreicht

Gleicher sichtbarer Assistant-Text kann zu unterschiedlichen Reasoning-Verläufen gehören. Hinzu kommen parallele Chats, Regenerationen, identische Toolnamen, Fensterneustarts, Modellwechsel und gekürzte Historien.

Der öffentliche Providerguide zeigt in `LanguageModelChatRequestMessage` Rolle, Inhalt und optionalen Namen, aber keine garantierte stabile Chat-ID. Deshalb darf eine Session-ID nicht als vorhanden angenommen werden. [web:5]

Konsequenz: Vollständig zuverlässiges allgemeines Cross-Turn-Replay lässt sich aus einem Texthash allein nicht ableiten. Diese Grenze ist ein Architektur- und Freigaberisiko, kein bloßes Cache-Tuning.

### 10.4 Replay-Datensatz

Ein Datensatz enthält ausschließlich im RAM:

- eigene Request-ID;
- Modell-ID und Endpointprofil;
- Credential- und Konfigurationsgeneration;
- kanonischen Fingerprint des vollständigen relevanten Eingabeverlaufs;
- kanonische Darstellung des erzeugten Assistant-Turns;
- Call-IDs und originale Toolnamen;
- vollständige sichtbare Ausgabe und rohe Argumentstrings;
- exakt empfangenes `reasoning_content`;
- Zeitstempel, Byteanzahl und eindeutigen Abschlussstatus.

Keine alleinige Zuordnung über eine kurze Textantwort. Fingerprints erhalten einen pro Extension-Host zufälligen Namespace; sie sind nicht für Telemetrie bestimmt. Rohdaten nicht persistieren.

### 10.5 Zuordnungsalgorithmus und Grenzen

1. Nur Datensätze derselben Modell-, Endpoint-, Credential- und Konfigurationsgeneration betrachten.
2. Den vollständigen erwarteten Vorgängerverlauf und Assistant-Turn mit dem eingehenden Verlauf vergleichen.
3. Bei Toolfortsetzungen zusätzlich alle Call-IDs und Ergebnisse berücksichtigen.
4. Bei keinem Treffer keine vermeintlich passende Antwort aus anderen Verläufen auswählen.
5. Bei mehreren passenden Datensätzen nicht „den neuesten“ wählen, sondern als mehrdeutig abbrechen.
6. Nach Hostkompaktierung, Modellwechsel oder Neustart keine Vollständigkeit behaupten.
7. Fehlende Informationen nicht aus sichtbarem Text rekonstruieren.
8. Für normales Cross-Turn-Replay ist auch ein einzelner lokaler Treffer kein mathematischer Beweis einer global eindeutigen Unterhaltung; ohne stabile Hostidentität bleibt diese Funktion experimentell.

Releaseentscheidung:

- Kann die reale Hostintegration keine ausreichend sichere Zuordnung für Toolfortsetzungen liefern, bleibt Tool Calling für diese Kombination deaktiviert.
- Möglichst einen dokumentierten Metadaten-Roundtrip der gepinnten stabilen API verwenden, falls vorhanden und getestet.
- Fehlt dieser, ist ein ausdrücklich begrenzter Verlaufsmatcher nur für bestätigte Szenarien zulässig. Mehrfenster-, Parallelitäts- und Branchtests sind Pflicht.
- Allgemeines Preserved Thinking darf nicht als zuverlässig beworben werden, solange die Identitätsfrage offen ist.

### 10.6 Cachegrenzen und Löschung

Projektstartwerte:

- höchstens 32 MiB Replay-Daten pro Extension Host;
- höchstens 100 abgeschlossene Einträge;
- TTL 30 Minuten;
- LRU-Verdrängung unter Beachtung aktuell verwendeter Einträge;
- keine Veröffentlichung eines Toolcalls, dessen erforderlicher Replay-Datensatz nicht gehalten werden kann;
- Clear bei Schlüsselrotation, relevantem Profilwechsel, explizitem Löschcommand und Deaktivierung;
- laufende Requests besitzen getrennte, ebenfalls begrenzte Buffer.

Bei Cacheverlust: verständlicher Fehler mit Hinweis auf eine neue Unterhaltung; keine automatische Neuanfrage. Reasoning wird weder als normaler Chattext ausgegeben noch protokolliert.

## 11. Streaming, Transport und Ressourcengrenzen

### 11.1 SSE-Parser

Ein Fetch-Chunk entspricht weder einer UTF-8-Zeichenfolge noch einer Zeile noch einem Event.

Der Parser muss:

1. `TextDecoder` inkrementell mit Streamingmodus verwenden.
2. Unvollständige Byte- und Zeilenfragmente über Chunks behalten.
3. LF und CRLF auch über Chunkgrenzen korrekt behandeln.
4. Kommentare und Heartbeats erkennen.
5. Mehrere `data:`-Felder eines Events nach SSE-Regeln zusammenführen.
6. Erst nach der leeren Eventabschlusszeile ein Event ausgeben.
7. JSON erst aus dem vollständigen Data-Inhalt parsen.
8. `data: [DONE]` als eigenes Abschlussereignis behandeln.
9. Usage-only-Events ohne `choices[0]` zulassen.
10. Anbieterfehler auch in einem HTTP-200-Stream erkennen.
11. Unbekannte Felder zulassen, aber fehlende Pflichtstruktur nicht ignorieren.
12. EOF ohne bestätigten Abschluss nicht als Erfolg behandeln.

Die Z.ai-Referenz dokumentiert SSE und den Endmarker `[DONE]`. Für den initialen strikten Vertrag werden ein gültiger Abschlussgrund und der Endmarker verlangt. Ein abweichender realer Anbieterstream wird nur mit eigener Fixture und expliziter Regel aufgenommen. [web:4]

### 11.2 Unterschiedliche Aktivitätsbegriffe

- Erste Bytes: Verbindung lebt, aber noch keine gültige Modellantwort.
- Heartbeat: Transportaktivität, nicht notwendigerweise Modellfortschritt.
- Erstes gültiges Event: First-Event-Timer beenden.
- Erstes Reasoning: Modell erzeugt Reasoning, aber noch keinen sichtbaren Text.
- Erster Text: Time-to-First-Visible-Text.
- Erster vollständiger Toolbatch: toolfähige Antwort abgeschlossen.

Heartbeataktivität darf den Gesamtdeadline-Timer nicht unbegrenzt hinausschieben. Für Transport- und semantischen Idle sind getrennte Zustände oder mindestens eine klare dokumentierte Definition nötig.

### 11.3 Abbruch und Timeout

- Vor Listenerregistrierung und unmittelbar danach `token.isCancellationRequested` prüfen.
- Ein Request-AbortController verarbeitet Hostabbruch und eigene Deadlines.
- Abbruchgrund unterscheiden: Nutzer, First-Event-Timeout, Idle-Timeout, Gesamtdeadline, Deaktivierung.
- Abbruch vor Netzwerkzugriff sendet keinen Request.
- Beim Abbruch nach Verbindung `fetch` und Reader abbrechen.
- Danach keine weiteren Text- oder Toolparts berichten.
- Promise zeitnah auflösen oder mit geeignetem Abbruchfehler beenden.
- In `finally` alle Timer und Listener entfernen.
- Abbruch stoppt lokal die Verarbeitung; er garantiert nicht, dass der Anbieter keine Tokens mehr abrechnet.

### 11.4 Projektgrenzen gegen Speicher- und Parserprobleme

| Ressource | Startgrenze | Reaktion |
|---|---|---|
| Serialisierter Text-/Toolrequest | 16 MiB | Vor Versand ablehnen |
| Einzelnes SSE-Event | 4 MiB | Stream abbrechen |
| Argumente eines Toolcalls | 1 MiB | Batch ablehnen |
| Gesammelte Argumente pro Antwort | 4 MiB | Stream abbrechen |
| Reasoning eines einzelnen Requests | 8 MiB | Abbrechen; nicht still abschneiden |
| Parallele Modellrequests pro Host | 3 | Weitere Requests vor Versand verständlich ablehnen |

Diese Werte sind Projektentscheidungen, keine Z.ai-Limits. Bytezahlen auf UTF-8-Basis messen. Lange Requests und Bilder können später angepasste Limits benötigen. Tests dürfen Grenzen überschreiten, müssen aber ohne übermäßigen Speicherverbrauch deterministisch scheitern.

## 12. Tokenzählung und gemeinsames Kontextbudget

### 12.1 Drei verschiedene Zahlen

1. Kontextbudget: gemeinsamer Raum für Eingabe, relevante Historie und Ausgabe.
2. Provider-Outputlimit: die maximal von dieser Extension angebotene Ausgabe.
3. Request-Outputbudget: der für diese konkrete Antwort angeforderte Wert.

Projektstartwerte für freigegebene 5.3-Modelle:

```text
providerContextBudget          = 1.000.000 Tokens
providerMaxOutputTokens        =    16.384 Tokens
defaultRequestMaxOutputTokens  =    16.384 Tokens
inputSafetyMarginTokens        =     8.192 Tokens
```

Veröffentlichtes Inputbudget als konservative Startformel:

```text
maxInputTokens = contextBudget - providerMaxOutputTokens - safetyMargin
```

Die offizielle VS-Code-Anleitung zeigt ebenfalls eine Ableitung des Inputlimits aus Kontextfenster minus Output. Die hier zusätzlich gewählte Sicherheitsmarge berücksichtigt Schätzfehler. [web:5]

Die 16.384 Tokens sind keine Behauptung über das Anbietermaximum. Ein später höheres konfigurierbares Providerlimit erfordert aktualisierte Modellinformationen und Budgetprüfung. Reasoning kann das verfügbare Ausgabe-/Kontextbudget beeinflussen; dessen genaue Abrechnung und Limitwirkung ist für die verwendete Kombination per Test zu bestätigen.

### 12.2 `provideTokenCount`

Nicht `text.toString()` auf ein Nachrichtenobjekt anwenden. Stattdessen:

- String: tatsächlichen String schätzen.
- Nachricht: Rollen-/Namensoverhead und jeden unterstützten Inhaltsteil berücksichtigen.
- Toolcall: Namen und serialisierte Argumente einbeziehen.
- Toolresultat: vollständigen gesendeten Text einbeziehen.
- Gesamter Request: zusätzlich Tooldefinitionen, Systemrahmen und Replay-Reasoning berücksichtigen.
- Bilder: nur mit bestätigtem Schätzmodell freigeben.

Der Host-Callback zählt möglicherweise nicht den vollständigen späteren Payload. Deshalb ist eine zweite Preflight-Budgetprüfung des endgültigen API-Requests zwingend.

### 12.3 Schätzverfahren

MVP: eine schnelle, bewusst konservative UTF-8-basierte Schätzung mit dokumentiertem Strukturaufschlag. Diese bleibt eine Schätzung und ist nicht für jede Sprache oder Datenform garantiert exakt.

Optional später: getesteter GLM-kompatibler Tokenizer. `cl100k_base` darf höchstens als ausdrücklich fremde Näherung verwendet werden, nicht als korrekter GLM-Tokenizer.

Kalibrierung:

- deutsche und englische Texte;
- Java, TypeScript, Python und JSON;
- CJK, Emoji, lange Zeilen und minifizierte Daten;
- Tooldefinitionen und große Toolresultate;
- Vergleich mit tatsächlichem `usage.prompt_tokens`, soweit im Antwortformat geliefert. Die API beschreibt Usage-Zahlen am Antwortende. [web:4]

### 12.4 Budgetüberschreitung

Nie unbemerkt letzte Nachrichten, Toolresultate oder Reasoning abschneiden. Vor dem Versand mit verständlicher Ursache abbrechen und auf neue Unterhaltung bzw. hostseitige Kontextreduktion verweisen. Eine spätere Kompaktierung muss komplette Toolsequenzen erhalten und ist ein eigenes Feature, kein spontaner Mapper-Workaround.

## 13. Fehlerstrategie und Wiederholungen

### 13.1 Fehlerkategorien

| Fall | Nutzerinformation | Automatisches Verhalten |
|---|---|---|
| Nicht konfiguriert | Profil und Schlüssel konfigurieren | Kein Netzwerkzugriff |
| HTTP 400 | Anfrage-/Parameterproblem, redigierter Code | Kein Retry, keine Rollenreparatur |
| HTTP 401 | Schlüssel ungültig oder nicht akzeptiert | Kein automatischer Dialog, Schlüssel nicht löschen |
| HTTP 403 | Berechtigung/Profil/Kontozugriff prüfen | Kein Endpointwechsel |
| HTTP 404 | Modell oder Pfad nicht verfügbar | Keine erfundene Ersatzmodellwahl |
| HTTP 429 | Rate Limit oder Kontingent; Wartehinweis falls geliefert | Kein automatischer Replay |
| HTTP 5xx | Anbieter vorübergehend nicht verfügbar | Im MVP kein automatischer Replay |
| Netzwerkfehler | Verbindung/Proxy/TLS prüfen | Kein TLS-Bypass |
| Streamfehler | Antwort unvollständig | Keine gepufferten Toolcalls veröffentlichen |
| Ungültige Argumente | Toolantwort nicht sicher verwertbar | Batch ablehnen |
| Nutzerabbruch | Anfrage abgebrochen | Keine weiteren Teile berichten |
| Replay mehrdeutig/fehlend | Fortsetzung nicht sicher rekonstruierbar | Vor Versand abbrechen |

Anbieterfehler können zusätzliche Codes enthalten. Diese aus begrenztem, redigiertem Fehlerbody extrahieren; HTML-Fehlerseiten nicht in voller Länge in den Chat kopieren.

### 13.2 Warum zunächst kein automatischer Retry?

Nach dem Versand kann die Extension oft nicht beweisen, ob der Anbieter bereits Tokens verarbeitet hat. Nach sichtbarer Ausgabe oder Toolveröffentlichung wäre ein Replay zusätzlich semantisch gefährlich.

Deshalb:

- Modellrequests im MVP niemals automatisch wiederholen.
- `request_id` nur für Korrelation verwenden; keine nicht dokumentierte Idempotenz daraus ableiten.
- `Retry-After` bei Bedarf als Nutzerhinweis anzeigen, ohne automatische Neuanfrage.
- Eine spätere Retry-Funktion braucht eigene Regeln und Tests für sicher identifizierbare Vorversandfehler.
- Bereits veröffentlichte Tools niemals automatisch erneut anfordern oder ausführen.

## 14. Datenschutz, Sicherheit und Betriebsumgebung

### 14.1 Datenfluss

Die Extension sendet nur Inhalte, die der Host im Modellrequest übergibt, plus die erforderlichen Tooldefinitionen und eindeutig zugeordneten Replay-Daten. Sie scannt nicht eigenständig das gesamte Repository.

Vor der ersten bewussten Nutzung erklären:

- ausgewählter externer Anbieter und Endpointprofil;
- mögliche Übertragung von Code, Chattext und Toolresultaten;
- mögliche Kosten und Quoten;
- Unterschied zwischen lokalem Provideradapter und externer Modellverarbeitung;
- keine eigene Zusage über Datenhaltung oder Trainingsausschluss des Anbieters.

Konkrete rechtliche und datenschutzrechtliche Anbietereigenschaften nur nach aktueller eigener Prüfung dokumentieren.

### 14.2 Logging

Zulässig:

- lokale Request-Korrelation;
- Modell-ID und Profil;
- Dauer, Eventanzahl und Byteanzahl;
- redigierter HTTP-/Anbieterfehlercode;
- Abschlussgrund und Abbruchkategorie.

Nicht zulässig, auch nicht bei `debug`:

- API-Key oder Authorization-Header;
- komplette Requests/Responses;
- Quellcode, Prompts, Toolargumente und Toolausgaben;
- Reasoning-Inhalte;
- Bilddaten oder Data-URLs;
- vollständige Dateipfade ohne ausdrückliche Diagnoseentscheidung.

Kein externer Telemetrieversand im MVP. Diagnosen vor einer möglichen Weitergabe lokal prüfen lassen.

### 14.3 Host und Netzwerk

- Erste Zielplattform: VS Code Desktop auf Windows, Linux und macOS.
- Remote SSH und WSL: eigener Testblock, weil Ausführungsort, Netzwerkroute und Secrets abweichen können.
- `extensionKind` in Phase 0 bewusst festlegen und mit dem vorgesehenen Providerhost testen.
- Keine parallele lokale und entfernte Registrierung derselben Vendor-ID.
- Web-Extension/Browserhost nicht ohne getrennten Bundle-, CORS- und SecretStorage-Test versprechen.
- Node-/Fetch-Funktionen nach der tatsächlichen Extension-Host-Runtime auswählen; moderne Entwickler-Node-Version nicht mit der eingebetteten Runtime verwechseln.
- Proxy- und Zertifikatsverhalten des verwendeten HTTP-Stacks konkret testen. Nicht voraussetzen, dass beliebige VS-Code-Proxysettings automatisch für jeden Fetch-Client gelten.
- Nie `NODE_TLS_REJECT_UNAUTHORIZED=0` empfehlen oder Zertifikatsprüfung deaktivieren.

## 15. Teststrategie mit prüfbaren Fällen

### 15.1 Unit-Tests: Mapping

- Usertext unverändert.
- Mehrere Textteile ohne Bedeutungsverlust.
- Assistant mit Text und mehreren Toolcalls.
- Mehrere Toolresultate mit unveränderten IDs.
- Gemischte Inhaltsteile in korrekter Reihenfolge.
- Leere Nachrichten und ausschließlich Assistant/System.
- Unbekannte Rollen und unbekannte Inhaltsteile.
- Toolresultat ohne früheren Call.
- Fehlendes und vorhandenes Tool-Schema.
- Doppelte, lange und ungültige Toolnamen.
- Kollisionsfreiheit und Rückabbildung von Toolnamen.
- 128 Tools zulässig, 129 nicht still abgeschnitten.
- JSON-Zirkularität, nichtserialisierbare Werte und übergroße Payloads.

### 15.2 Unit-Tests: SSE und Toolstreams

Die gleichen Fixtures durch jede mögliche einzelne Byte-Splitposition laufen lassen; zusätzlich zufällige Mehrfachsplits mit reproduzierbarem Seed verwenden.

Pflichtfälle:

- Text über mehrere Events.
- UTF-8-Zeichen über Bytegrenzen.
- CRLF über Chunkgrenzen.
- Mehrere Events in einem Chunk.
- Event über viele Chunks.
- Mehrzeilige Data-Felder und Kommentare.
- Usage-only-Event ohne Choices.
- Fehlerobjekt innerhalb HTTP 200.
- `[DONE]` mit und ohne gültigen Abschlussgrund.
- EOF ohne Endmarker.
- `length` bei teilweise aufgebautem Toolcall.
- Zwei verschachtelt gestreamte Toolindizes.
- IDs/Namen einmalig, wiederholt und widersprüchlich.
- Unvollständiges JSON, falscher Argumenttyp, unbekannter Toolname.
- Überschreitung jeder Buffergrenze.
- Kein Toolpart vor der vollständigen Batchvalidierung.

### 15.3 Unit-Tests: Replay und Parallelität

- Zwei Chats mit identischem sichtbarem Assistanttext und anderem Reasoning.
- Zwei gleichzeitig erzeugte Antworten auf gleiche Historie.
- Regeneration und Gesprächsverzweigung.
- Exakte Zuordnung über bestätigte Tool-ID und Vorgängerverlauf.
- Mehrdeutiger Treffer endet sicher statt „neuester gewinnt“.
- Modell-, Profil- und Schlüsselwechsel entwerten alte Einträge.
- TTL, LRU und Größenlimit.
- Cacheverlust nach Neustart.
- Abbruch und Netzwerkfehler schreiben keinen vollständigen Eintrag.
- Abbruch zwischen Cachecommit und Toolveröffentlichung.
- Host sendet Folgeanfrage unmittelbar nach Toolpart; notwendige Daten sind bereits sichtbar.
- Hostkompaktierung erzeugt kein falsches Replay.

### 15.4 Mock-HTTP-Integration

Lokaler Mockserver ausschließlich in Tests; die Produktionsallowlist wird nicht durch allgemeine Nutzer-URL-Settings aufgeweicht.

Tests:

- korrekter Pfad für beide Profile;
- richtige Header, kein Secret im Log;
- 400/401/403/404/429/500 und Nicht-JSON-Fehlerseiten;
- Retry-After als Hinweis, kein Replay;
- Redirect wird abgelehnt;
- fehlender Body oder falscher Content-Type;
- langsamer First Event, Heartbeats, Idle und Gesamttimeout;
- Requestabbruch vor und nach Headern;
- Verbindungsabbruch nach Text und vor Toolabschluss;
- Deaktivierung beendet alle aktiven Requests;
- maximal zulässige Parallelität wird eingehalten.

### 15.5 Extension-Host-Tests

- Manifest wird ohne Fehler geladen.
- Provider wird genau einmal registriert.
- Management-Command funktioniert vor Modellnutzung.
- Silent Discovery öffnet keinen Dialog.
- Modellangebot berücksichtigt Profil und Freigabestatus.
- Textpart erscheint inkrementell.
- Hostabbruch stoppt den Stream.
- Capability-Änderung wird sichtbar oder dokumentierter Reload funktioniert.
- Keine privaten VS-Code-Commands oder Proposed APIs nötig.

### 15.6 Manuelle Live-Matrix

| Szenario | Standard | Coding Plan | Ergebnisregel |
|---|---|---|---|
| GLM-5.3 Textchat | testen | testen | Eintrag getrennt freigeben |
| GLM-5.3-Flash Textchat | testen | testen | Eintrag getrennt freigeben |
| GLM-5.3-FlashX Textchat | testen | nicht anbieten | Kein Plan-Fallback |
| Toolaufruf + Toolresultat + Antwort | je freigegebenem Modell | je freigegebenem Modell | Agent-Capability erst danach |
| Zweite Toolrunde in derselben Aufgabe | testen | testen | Reasoning-Fortsetzung prüfen |
| Zwei parallele Chats und Verzweigung | testen | testen | Keine Vermischung |
| Inline Chat und Edit-Oberfläche | gesondert prüfen | gesondert prüfen | Ergebnis dokumentieren, nicht voraussetzen |
| Bilder | später | später | Bis Freigabe `imageInput: false` |

Live-Tests sind bewusst auszulösen und können Kosten verursachen. Normale CI läuft ohne echte API-Schlüssel und ohne externe Modellrequests.

## 16. Umsetzung in Phasen mit Abhängigkeiten

Aufwände sind grobe Schätzungen in konzentrierten Entwicklungstagen für eine Person, keine Zusage. Kontozugriff, Typänderungen und Hostprobleme können die Dauer wesentlich verändern.

### Phase 0: Machbarkeit und API-Vertrag — 1 bis 2 Tage

Aufgaben:

- [ ] Repo, Paketname und Vendor-ID vereinheitlichen.
- [ ] Stabile VS-Code-Zielversion und passende Typen festlegen.
- [ ] Minimalprovider mit gültigem Manifest kompilieren.
- [ ] Aktivierung, Modellanzeige und Mock-Textantwort testen.
- [ ] Hostrollen, Inputparts, Tooloptionen und Refreshmöglichkeiten dokumentieren.
- [ ] Prüfen, ob ein stabiler Metadaten-Roundtrip oder eine verlässliche Chatidentität verfügbar ist.
- [ ] Ausführungsort und `extensionKind` entscheiden.
- [ ] Anbieterbedingungen für die beabsichtigte Coding-Plan-Nutzung prüfen.

Gate G0: Minimalprovider funktioniert auf der deklarierten Mindestversion; alle Typen und Manifestfelder sind bestätigt. Ohne G0 keine Feature-Implementierung auf geratenen APIs.

### Phase 1: Grundgerüst und sichere Konfiguration — 1 bis 2 Tage

Aufgaben:

- [ ] TypeScript strict, Linting, Testframework und Lockfile einrichten.
- [ ] Buildbundle mit externem `vscode`-Modul erstellen.
- [ ] Manifest mit verifizierter Engineversion, Commands und Settings schreiben.
- [ ] SecretStorage-Wrapper mit profilorientierten Einträgen implementieren.
- [ ] Setup, Schlüsseländerung, Löschung und Migration testen.
- [ ] Endpointallowlist und Snapshotkonfiguration erstellen.
- [ ] Redigierten Logger und lokale Diagnosen implementieren.

Gate G1: Keine Secrets im Paket oder Log; keine Netzwerkverbindung bei Aktivierung und Silent Discovery.

### Phase 2: Protokollkern und Textchat — 2 bis 3 Tage

Aufgaben:

- [ ] Eigene Z.ai-Typen und RequestBuilder erstellen.
- [ ] Textmapping und frühe Verlaufsvalidierung implementieren.
- [ ] HTTP-Client mit Statusprüfung, Redirectverbot und AbortSignal bauen.
- [ ] Inkrementellen SSE-Parser samt Split-Tests implementieren.
- [ ] `reasoning_content` getrennt von sichtbarem Text erfassen.
- [ ] Abbruch und alle drei Timeoutklassen integrieren.
- [ ] Tokenestimator, Payloadlimits und Budgetprüfung ergänzen.
- [ ] Text-MVP mit deaktivierten Tool-/Bild-Capabilities live prüfen.

Gate G2: Verifizierter Textchat auf mindestens einer Modell-Profil-Kombination; keine stillen Trunkierungen, kein Replay bei Netzwerkfehlern.

### Phase 3: Tools und sichere Fortsetzungen — 3 bis 5 Tage

Abhängigkeiten: G0 und G2; insbesondere tatsächliche Hostoptionen und Replaymöglichkeiten müssen bekannt sein.

Aufgaben:

- [ ] Tooldefinitionen, Namen und Schemas abbilden.
- [ ] Nicht abbildbare Toolwahl ausdrücklich behandeln.
- [ ] Tool-Accumulator, Batchvalidierung und Finish-Reason-Prüfung schreiben.
- [ ] Toolresultate in der folgenden Anfrage abbilden.
- [ ] Begrenzten ReplayStore und strikten HistoryMatcher implementieren.
- [ ] Mehrere Tools, mehrere Runden und parallele Chats testen.
- [ ] Abbruch-/Race-Tests vor und während der Toolveröffentlichung durchführen.
- [ ] Erst jetzt Tool-Capability je geprüfter Kombination aktivieren.

Gate G3: Vollständiger Agent-Roundtrip ohne unsichere Reasoning-Zuordnung. Bei offenem Identitätsproblem wird Textchat veröffentlicht, nicht eine scheinbar funktionierende Agent-Unterstützung.

### Phase 4: Härtung und Benutzerführung — 2 bis 3 Tage

Aufgaben:

- [ ] Fehlertexte und Troubleshooting vervollständigen.
- [ ] Windows/Linux/macOS prüfen; Remoteumgebungen separat markieren.
- [ ] Proxy, TLS und lange Thinkingphasen testen.
- [ ] Cachelimits, Last und Speicherfreigabe überprüfen.
- [ ] Kompatibilitätsmatrix mit tatsächlichen Ergebnissen füllen.
- [ ] README, Datenschutzbeschreibung und Beschränkungen erstellen.

Gate G4: Keine offenen kritischen Sicherheits-, Datenzuordnungs- oder Protokollfehler.

### Phase 5: Release — 1 bis 2 Tage

Aufgaben:

- [ ] CI-Grün auf sauberem Checkout.
- [ ] Produktionsbundle und VSIX reproduzierbar erzeugen.
- [ ] Paketinhalt vor Veröffentlichung prüfen.
- [ ] Frische Installation und Upgrade testen.
- [ ] CHANGELOG, Lizenz und Kennzeichnung als unabhängige Integration finalisieren.
- [ ] Anbieter- und VS-Code-Dokumentation erneut gegen die freigegebenen Features prüfen.

Gate G5: Installierbares, getestetes VSIX ohne Secrets und ohne ungeprüfte Fähigkeitszusagen.

### Phase 6: Optionale Erweiterungen

- [ ] Bildinput mit gesondertem Budgetmodell.
- [ ] Vollständigeres Reasoning-Replay nur nach Lösung der Hostidentität.
- [ ] GLM-5.2 nach separater Modellprüfung.
- [ ] Dynamische Modelldiscovery nur mit dokumentiertem, getesteten Endpoint.
- [ ] Browserhost/Web-Extension mit eigener Architekturprüfung.
- [ ] Weitere Protokolle nur als eigene Adapter.

## 17. Build, CI und Paketierung

### 17.1 Vorgesehene NPM-Skripte

```json
{
  "scripts": {
    "check": "tsc --noEmit",
    "lint": "eslint src test",
    "test:unit": "vitest run",
    "build": "esbuild src/extension.ts --bundle --platform=node --format=cjs --external:vscode --outfile=dist/extension.js",
    "vscode:prepublish": "npm run check && npm run build",
    "package:vsix": "vsce package"
  }
}
```

Dies ist ein Planungsausschnitt, kein vollständiges `package.json`. Skripte für Mock-Integration und Extension-Host-Tests kommen mit der jeweiligen Teststruktur hinzu. Compiler, Node-Typen und Buildtarget müssen zum verifizierten Host passen.

Entwicklungsabhängigkeiten: TypeScript, exakt passende VS-Code-Typen, Node-Typen, esbuild, ESLint, TypeScript-Lintintegration, Vitest und `@vscode/vsce`; für Hosttests ein zum Projekt passender offizieller VS-Code-Test-Runner. Versionen erst nach G0 festlegen und per Lockfile reproduzierbar halten.

### 17.2 Lokaler Prüfablauf

Nach Einrichtung der tatsächlichen Skripte:

```bash
npm ci
npm run check
npm run lint
npm run test:unit
npm run build
npm run package:vsix
```

Vor Paketierung zusätzlich Mock-Integration und Hosttests ausführen. `main` muss auf das gebaute Bundle zeigen; `vscode` bleibt extern und wird vom Host bereitgestellt.

### 17.3 CI-Regeln

- Pull Requests: Install, Typprüfung, Lint, Unit- und Mocktests, Build.
- Hosttests: deklarierte Mindestversion sowie aktuelle unterstützte stabile Version.
- Release: Paketierung plus Inhaltsscan auf Secrets und versehentliche Fixtures.
- Keine Live-API-Tests aus fremden Pull Requests.
- Keine automatischen NPM-/Marketplace-Releases ohne bewusstes Releaseverfahren.
- Testberichte erfassen Versionen und Commit, keine geheimen Inhalte.

### 17.4 Paketinhalt

Enthalten: Manifest, Bundle, README, Lizenz, Changelog und notwendige Assets.

Ausschließen: `.env`, Schlüsseldateien, lokale Einstellungen, echte Chatmitschnitte, Reasoning-Dumps, Testserver, unnötige Entwicklungsdateien und nicht benötigte Abhängigkeiten. Repository- und Publisherangaben erst nach tatsächlicher Festlegung eintragen; keine Beispielidentität veröffentlichen.

## 18. Risikoregister und offene Entscheidungen

| Risiko | Priorität | Gegenmaßnahme | Releasefolge bei ungelöstem Risiko |
|---|---|---|---|
| Provider-API fehlt in angenommener Zielversion | kritisch | Phase-0-Spike | Mindestversion anheben oder stoppen |
| Keine belastbare Identität für Reasoning-Replay | kritisch für Agent | Metadatenprüfung, strikte Matcher, Paralleltests | Tools aus; nur Textchat |
| Pflicht-Toolwahl nicht abbildbar | hoch | Hostoptionen und API-Vertrag prüfen | Betroffene Agentfunktion nicht anbieten |
| FlashX wird im Coding Plan beworben | hoch | Endpunktabhängige Filterung | Kein entsprechender Eintrag |
| Thinking-disabled-Payload für 5.3 | hoch | Capabilityvalidierung und Tests | Release blockiert |
| Fehlerhafter Call wird zu früh veröffentlicht | kritisch | Ganze Batches validieren | Release blockiert |
| Secret oder Code landet im Log | kritisch | Redactiontests und Paketprüfung | Release blockiert |
| Kontextschätzung ist zu optimistisch | hoch | Konservative Budgets, Usage-Kalibrierung | Kleinere Limits oder Modell sperren |
| API-Dokumente unterscheiden sich | mittel | Modellseite + konkreter Integrationstest | Strittige Option experimentell halten |
| Proxy/Remotehost funktioniert nicht | mittel | Getrennte Tests | Umgebung als nicht unterstützt kennzeichnen |
| Automatischer Fallback verursacht Kosten | hoch | Kein Endpoint-/Modellfallback | Release blockiert, wenn noch vorhanden |
| Z.ai ändert Modell oder Kontozugriff | mittel | Katalogrevision und verständliche Fehler | Kein stiller Ersatzanbieter |

Vor G0 verbindlich entscheiden:

- konkrete VS-Code-Mindestversion und Typen;
- vorgesehener Extension Host;
- mögliche öffentliche Metadaten-/Identitätsmechanismen;
- tatsächliche Toolwahloptionen des Hosts;
- erste regulär getestete Modell-Profil-Kombination;
- Zulässigkeit der beabsichtigten Coding-Plan-Integration nach aktuellen Bedingungen.

Vor G3 zusätzlich entscheiden:

- Welche Toolfortsetzungen lassen sich tatsächlich sicher zuordnen?
- Was passiert bei Historienkompaktierung oder Fensterneustart?
- Welche Kombinationen bestehen zwei Toolrunden und parallele Chats?
- Kann eine vollständige Agentunterstützung beworben werden oder nur Textchat?

## 19. Definition of Done

### 19.1 Funktional

- [ ] Modell erscheint in einem getesteten Host und wird nicht aufgrund falscher Capabilities beworben.
- [ ] Standard und Coding Plan sind explizit getrennt.
- [ ] FlashX wird nicht im aktuell ausgeschlossenen Planprofil angeboten.
- [ ] Textstream funktioniert inkrementell und Unicode-sicher.
- [ ] Thinking wird für die 5.3-Serie nie deaktiviert angefordert.
- [ ] Token- und Payloadlimits werden vor Versand geprüft.
- [ ] Agent-Unterstützung besteht vollständige Tool-Roundtrips einschließlich Reasoning-Fortsetzung.
- [ ] Bilder bleiben deaktiviert, bis sie vollständig implementiert und getestet sind.

### 19.2 Sicherheit und Robustheit

- [ ] Keine Secrets in Settings, Logs, Paket oder Fixtures.
- [ ] Kein Prompt-/Rollenumbau als versteckter Fehlerworkaround.
- [ ] Keine unsichere Reasoning-Zuordnung zwischen Chats.
- [ ] Keine unvollständigen Toolcalls nach Streamfehlern.
- [ ] Kein automatischer Endpointwechsel, Retry oder kostenpflichtiger Hintergrundtest.
- [ ] Cancellation, Timeout und Deaktivierung räumen Ressourcen auf.
- [ ] Alle Buffer sind begrenzt.
- [ ] Anbieterfehler werden redigiert und verständlich dargestellt.

### 19.3 Qualität und Lieferung

- [ ] Typprüfung, Lint, Unit-, Mock- und Hosttests grün.
- [ ] Mindestversion und aktuelle unterstützte Version getestet.
- [ ] Frisches VSIX installiert und gestartet.
- [ ] Kompatibilitätsmatrix nennt tatsächliche statt angenommene Ergebnisse.
- [ ] README trennt Textchat, Agent, Inline Chat und Inline Completions.
- [ ] Datenschutz, mögliche Kosten und bekannte Beschränkungen verständlich dokumentiert.
- [ ] Offene Risiken besitzen eine bewusste Featurebegrenzung statt eines stillen Workarounds.

## 20. Priorisierte Startanweisung für die Implementierung

1. Zuerst den Minimalprovider mit den echten stabilen Typen und gültigem Manifest bauen.
2. Danach exakt einen dokumentierten Modell-Endpunkt-Pfad für Textchat freigeben.
3. Parser, Mapping, Abbruch und Tests vor Modellbreite und UI-Politur stabilisieren.
4. Tool Calling erst nach sauberem Batchabschluss, korrekten Resultaten und belegter Replayzuordnung aktivieren.
5. Die offene Chatidentität als harte Grenze behandeln: lieber eine ehrliche Textchat-Version als eine unsichere Agent-Version.
6. Bilder, GLM-5.2, automatische Discovery und zusätzliche Protokolle getrennt nachziehen.

Die Reihenfolge verhindert, dass eine große Modellliste oder ein sichtbarer Agent-Picker eine unvollständige Protokollimplementierung verdeckt.
