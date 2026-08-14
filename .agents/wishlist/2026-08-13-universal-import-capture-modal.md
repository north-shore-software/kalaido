---
title: "Universal 'Import Something' Capture Modal"
status: "idea"
author: "human"
created: "2026-08-13"
---

## Summary
Evolve the "Add Note" modal into a universal "Import Something" capture interface that accepts typed text, drag-and-drop files, and direct clipboard pastes (including images, code snippets, and PDF documents).

## Motivation / Use Case
Users currently have to choose between different workflows when adding notes versus importing files or capturing screenshots. A single, multi-modal capture box removes cognitive load: whether a user wants to type a note, paste a screenshot from their clipboard, or drag in a document, they can use the exact same input surface.

## Proposed Concept
1. **Universal Drop Zone & Editor**:
   - The modal input field acts simultaneously as a text editor and an active drag-and-drop dropzone.
2. **Clipboard Paste Handling**:
   - Intercept paste events (`Cmd+V` / `Ctrl+V`) to handle pasted images, rich text, binary files, or raw code automatically.
3. **Attachment Preview Rail**:
   - Display visual previews for attached/pasted images, document file chips, and metadata before committing the ingest.
4. **Unified Ingest Dispatch**:
   - On submission, route text to text fragment writers, images to image/visual fragment processors, and files to document ingestion pipelines seamlessly.

## Open Questions
- How should compound inputs (e.g., typed text accompanied by a pasted image and a PDF file) be stored—as a single linked composite fragment or as separate related fragments?
- What file size or mime-type limits should be enforced for inline image/document pastes?
- Should automated text extraction / OCR run immediately on pasted images and documents during ingest?
