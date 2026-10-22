# numberone

A Claude Code plugin that runs a routine to its end and calls you only for decisions.

Like a starship's first officer, numberone runs the routine and calls the captain when a decision is the captain's to make. You start a flow, such as "take this PR from ready to merged and move its ticket along". numberone waits on GitHub, your issue tracker and your chat without spending model tokens. It does every step the playbook allows and hands narrow judgments to the smallest model that can make them. It wakes your session only when it needs you.

> **Status: design only.** Nothing runs yet. Read [ARCHITECTURE.md](ARCHITECTURE.md) for the design and its open questions.

## Install

<!-- Placeholder until the first release. -->

```
/plugin marketplace add JawsomeJason/numberone
/plugin install numberone@numberone
```

Needs: `gh` (with the `gh stack` extension for stack flows), `jq`, Node 22+, and access to your tracker and chat.

## Setup

<!-- Placeholder: setup is not implemented. -->

```
/numberone setup
```

`setup` asks who you are, which forge, tracker and chat you use, which channel is for review pings, who your QA contact is, and how your tracker's statuses map onto flow stages. It writes your answers to one memory file. That file holds references to your secrets, never the secrets themselves. Check it any time:

```
/numberone doctor
```

## First run

<!-- Placeholder: the runner is not implemented. -->

```
/numberone list                          # flows and atoms you have
/numberone run pr-to-done 1234           # take PR #1234 from ready to merged
/numberone status                        # where every run stands, and what it waits on
```

numberone posts only where your send rules allow. Every other message lands as a draft on your private drafts canvas, with a "send it for me" box. Anything beyond the flow's playbook needs a grant you approve in plain words.

## Packs

Your organization's own steps belong in a pack: a separate, usually private, plugin with its own atoms and flows. Core never names an organization, person, channel, repository or skill. See [ARCHITECTURE.md section 7](ARCHITECTURE.md#7-packs) and `packs/example/`.

## License

[MIT](LICENSE)
