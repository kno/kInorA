# 13-v1.1-interactive-voice-chat Specification

## Purpose

Enable voice-assistant screens for voice-based plan definition and conversational interaction via Whisper STT and OpenAI TTS, complementing text chat.

This spec maps to the mobile voice assistant Open Design screen and remains v1.1 scope.

## Requirements

### Requirement: Speech-to-Text Input

The system MUST accept voice input via microphone, transcribe it using Whisper (or equivalent STT), and feed the transcribed text into the chat system.

#### Scenario: Voice input transcribed

- GIVEN a user speaks "I want to work out four times a week" into the microphone
- WHEN the voice recording is submitted
- THEN the system returns the transcribed text and processes it as a chat message

#### Scenario: Silence or unrecognizable audio

- GIVEN a user submits a recording with silence or background noise
- WHEN the STT processes the audio
- THEN the system returns a "Could not understand, please try again" prompt without crashing

### Requirement: Text-to-Speech Output

The system SHOULD read AI responses aloud using OpenAI TTS (or equivalent).

#### Scenario: Response read aloud

- GIVEN the AI generates a response to a voice query
- WHEN TTS is enabled
- THEN the response text is converted to speech and played on the device

#### Scenario: TTS disabled preference

- GIVEN a user has disabled TTS in settings
- WHEN the AI generates a response
- THEN only the text response is displayed, no audio is played

### Requirement: Voice Permission Handling

The system MUST request microphone permission and handle denial gracefully.

#### Scenario: Microphone denied

- GIVEN the user blocks microphone access
- WHEN they try to use voice input
- THEN the system shows a "Microphone access required" message and falls back to text input
