# Photos and albums

Photos are reusable publisher content. A reviewed photo can belong to several albums and connect to several knowledge items or information sections. An association says whether it depicts the actual subject or is an illustrative example. The platform chooses the relevant image in cards, details, comparisons and galleries; publishers do not configure each future placement.

## Publisher flow

1. Open **Files → Photos**. Add individual PNG/JPEG/WebP images, a batch, or a folder. Folder paths supply editable album names. Existing IPTC/XMP descriptions and credit are retained when recognized; generic camera filenames do not become public captions.
2. Select a group and optionally describe it in **What should we know about these photos?** **Suggest connections** uses filenames, supplied metadata and the note locally. Direct group controls can connect photos to an existing knowledge item, a content section or the site, as actual photos or examples.
3. Review the thumbnails. Captions, alternative text, credits, album order, album covers and lead images are editable. **Organize selected photos** can create another album, add the same photos to another album, or explicitly use the note as the album description. Notes are not silently published as captions.
4. **Apply to draft**, review the site preview, then use the existing **Publish** action. Unapplied uploads are private. Removing from an album only changes that album; removing from the reviewed library affects the next publication and leaves the private upload available.

Photos and albums work before a knowledge catalog exists. Manual browsing, album tabs, full-size viewing and keyboard navigation do not require AI or voice. Review edits survive Studio panel changes; site navigation asks before discarding edits. Partial upload failure retains completed uploads and existing review edits.

## Interpretation and identity

Connected publishers have a separate **Suggest from photos** action. It sends up to 20 selected sanitized thumbnails, draft subject names, existing photo descriptions and the publisher's note to the existing direct Responses connection. It makes one bounded request, with no automatic retries or extra batches, and consumes the existing server-side owner/global daily reservation. No source URL, original binary metadata, private filename from another site or provider credential is returned to visitors.

The interpreter returns a proposal. It cannot write the draft or publish. Unknown IDs, incomplete selection results, invalid associations, cancellations and malformed output are rejected. Existing nonempty captions and edited alternative text remain intact. Visual resemblance cannot establish a specific person, product, class or venue. A photo does not establish inventory, price, bookable capacity, accessibility guarantees or other live capabilities.

The API format follows the official [image input documentation](https://developers.openai.com/api/docs/guides/images-vision). The local demo never sends image/model requests, even when a key exists in its environment. General natural-language interpretation quality is unverified until an explicitly authorized live test.

## Runtime and shared package

`@thevoice/platform-ui/media` exports the bounded `MediaLibrary` contract and pure lookup/validation functions. Root React exports include `MediaProvider`, `MediaImage`, `EntityMedia` and `MediaGallery`. Hosts supply the image URL resolver; model plans contain approved IDs only. The shared package has no Next.js, Firebase or storage dependency.

- Cards and comparisons use approved actual photos, with a publisher-selected lead image first. Details can show visibly labeled examples.
- Gallery plans select approved assets, an album or an entity scope. The runtime validates the intersection and retains publisher album order. An explicit empty selection cannot silently turn into all photos.
- Standalone galleries conservatively label approved example images. Enlarged photos preserve their aspect ratio, support Escape and arrow keys, and return focus to the opening control.
- Thumbnail areas reserve space before loading. Disclosures and transitions use the existing controlled motion and reduced-motion behavior; there is no automatic slideshow.
- Photo ordinal requests such as “the second photo” require opening the intended image or naming its album. The runtime does not misinterpret photo positions as catalog item positions.

Image-opening observations record only the approved asset/revision IDs as `photo_view`. They are bounded, best-effort client observations, not proof of successful image delivery or a business conversion.

## Storage and publication

Each new image is decoded and checked, orientation-corrected, and re-encoded as a metadata-free WebP display (up to 2000 pixels) and thumbnail (up to 480 pixels). Originals remain private and separate from the repeatedly rewritten local workspace JSON. Firebase uses the existing private object storage. Legacy image uploads are sanitized when served.

Limits: 10 MB per uploaded photo, 40 million decoded pixels, 100 photos plus 20 other source files, and 100 MB total site storage including originals and image variants. Animated images and unsupported formats fail explicitly. PDF and text limits remain separate. [Image processing](../lib/image-processing.ts) uses the direct Sharp dependency declared in [package.json](../package.json).

Media descriptions and associations are stored as immutable private revisions; draft/published/history content carries only `mediaRevisionId`. Publication stages an immutable media manifest, then changes the site's published snapshot under the existing revision check. Public image requests authorize against the current published image allowlist. Uploading, interpreting or applying a new draft never exposes an unpublished image.

Private deletion is blocked while a photo is referenced by the draft, current publication or retained Undo history. Revisions retain at most the existing 20 draft-history entries. After removing photos or a logo from the draft and publishing, Files → Documents & original uploads → Files protected by Undo history → Clear Undo history releases files referenced only by old drafts. This explicitly confirmed action permanently removes draft Undo history; it does not change current draft/publication content or delete files. Use the individual Delete controls afterward. Current draft and publication references remain protected, and existing owner/revision checks still apply. An uncertain storage write failure can leave an inaccessible private orphan; no background cleanup, retry worker or extra cloud resource was introduced.

## Verification

Use Node 24 and the existing scripts: `npm run check`, then `npm run test:browser`. Tests use synthetic image bytes, local demo storage and mocked Firebase/model transports. They cover real image decode/orientation/metadata removal; publication and Undo boundaries; one-read public thumbnail authorization; malformed media and model references; real OpenUI parsing and the packed standalone package; publisher review, folders and partial uploads; contextual class/bookstore photos; keyboard/mobile rendering and existing motion behavior.

These checks do not establish live model quality, real Firebase deployment behavior or provider billing accuracy. No live paid API calls, signed-in browser testing, deployment or account changes are part of this implementation.

## Starting over with knowledge

Knowledge now places **Delete all draft knowledge** near the top whenever draft knowledge or collections exist. Open it, read the scope, type the site name, and confirm. Cancel leaves the draft unchanged. The operation removes both knowledge and collection publication references, preserves current publication and original files, and retains draft Undo. Pending proposals and photos are separate; this is not a full-site purge. Publish the empty draft to remove visitor information. The broader single-flow site reset is tracked in `docs/project-todo.md` as KNOWLEDGE-UX-01.

Website migrations can discover image references in Knowledge → Import a website, preview them on demand, and import selected batches without AI. These uploads use the same private storage and sanitized variants as ordinary photos. In Photos, open Add from uploaded files and use the website-image batch button to create an Imported website photos album for review. Apply the website knowledge before editing the photo draft; then review captions, alternative text and associations, Apply to draft, and Publish separately. See [website import](website-import.md) for download bounds and supported sources/formats.
