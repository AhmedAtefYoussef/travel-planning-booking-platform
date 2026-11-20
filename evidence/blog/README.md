# Swagger verification evidence: Malak's requirements (Blog)

**Evidence only:** this branch is never merged. It holds the Swagger UI screenshots that Malak's blog pull requests
link to (same convention as `docs/hotels-swagger-evidence`).

- **How the app ran:** the backend from `feature/BLG-01-blog-posts` on 16 Nov 2026, against a local demo database
  (`travel_demo`, a throwaway MongoDB replica set, not the team Atlas cluster), with real cookie login
  (`AUTH_STUB=false`) and the official reference data seeded.
- **How the screenshots were taken:** each one is a real Swagger UI "Try it out → Execute" run in a browser,
  driven by Claude Code (Playwright) and recorded as AI-assisted in `AI_PROMPTS.txt`. 45 runs, every one returned
  the expected status, plus 5 runs on 17 Nov after the PR #75 review (marked below). Each image shows the request (parameters, body, curl) and the live server response.
- **Accounts:** User A (`a@demo.com`, id `6afb5d55896830b0c9bee164`) is the author; User B (`b@demo.com`) is another
  registered user. Calls with no login cookie are a guest.
- **Demo data:** published post "Three days in Cairo" `6afb62b0896830b0c9bee522`, draft "Alexandria notes"
  `6afb62b2896830b0c9bee527`, published post "A day in Alexandria" `6afb62c0896830b0c9bee545` (deleted at the end).
- **Not shown:** `GET /api/posts?page=0`. Swagger UI blocks it in the browser ("Value must be greater than or equal
  to 1") before sending, so the server's 400 for bad pages is covered by `test/vv/foundation.vv.e2e-spec.ts` instead.

## BLG-01 (TRVL-85) create a post as draft or published

| File | What it shows |
|---|---|
| `blg-01/00-blog-operations.png` | `GET /api/docs`: the Blog section lists every blog operation |
| `blg-01/01-blg01-create-published-201.png` | `POST /api/posts` as User A, status PUBLISHED: 201, tags `Egypt`, `cairo `, `food` stored as `egypt`, `cairo`, `food`, `publishedAt` set |
| `blg-01/02-blg01-create-draft-201.png` | `POST /api/posts` with no status: 201, status DRAFT, `publishedAt` null |
| `blg-01/03-blg01-invalid-input-400.png` | Empty title: 400 `VALIDATION_FAILED` with a `title` field error |
| `blg-01/04-blg01-guest-creates-401.png` | `POST /api/posts` as a guest: 401 |
| `blg-01/05-blg01-images-on-create-400.png` | After the PR #75 review (17 Nov, branch `feature/BLG-01-create-post`): `images` sent on create, here `http://example.com/not-an-image.exe`, is refused with 400 on `images`; images are only uploaded to the post (GEN-08) |
| `blg-01/06-blg01-create-after-review-201.png` | After the review: a published post with tags `Egypt`, `cairo ` is still created (201) with tags `egypt`, `cairo` and the author name from the users module |

## BLG-02 (TRVL-86) browse published posts and view a post

| File | What it shows |
|---|---|
| `blg-02/01-blg02-guest-browses-200.png` | `GET /api/posts` as a guest: 200, published posts only (the draft is absent), page size 10 |
| `blg-02/02-blg02-filter-by-tag-200.png` | `GET /api/posts?tag=nile`: 200, only the post tagged `nile` |
| `blg-02/03-blg02-view-post-200.png` | `GET /api/posts/{id}` as a guest: 200 with title, author, dates, body, tags, images, like and comment counts |
| `blg-02/04-blg02-draft-hidden-404.png` | `GET /api/posts/{draftId}` as a guest: 404 |

## BLG-03 (TRVL-87) my posts, drafts included

| File | What it shows |
|---|---|
| `blg-03/01-blg03-my-posts-with-draft-200.png` | `GET /api/posts/mine` as User A: 200, the draft and the published posts with status, date, like and comment counts |
| `blg-03/02-blg03-open-my-draft-200.png` | `GET /api/posts/mine/{draftId}` as User A: 200, the full draft |

## BLG-04 (TRVL-88) author edits and deletes own posts

| File | What it shows |
|---|---|
| `blg-04/01-blg04-author-edits-200.png` | `PATCH /api/posts/{id}` as User A: 200, title changed |
| `blg-04/02-blg04-null-title-400.png` | `{"title": null}`: 400 (null is rejected, not ignored) |
| `blg-04/03-blg04-other-user-edits-403.png` | `PATCH` on User A's published post as User B: 403 "You can only change your own posts" |
| `blg-04/04-blg04-other-users-draft-404.png` | `PATCH` on User A's draft as User B: 404, as for an unknown id |
| `blg-04/05-blg04-other-user-deletes-403.png` | `DELETE` on User A's post as User B: 403 |
| `blg-04/06-blg04-author-deletes-204.png` | `DELETE /api/posts/{id}` as User A: 204 |
| `blg-04/07-blg04-deleted-post-404.png` | `GET /api/posts/mine/{id}` for the deleted post: 404 |
| `blg-04/08-blg04-reorder-own-images-200.png` | After the PR #75 review (branch `feature/BLG-04-edit-delete-posts`): `PATCH` with the post's two uploaded images in a new order: 200. The post and its two `/uploads/posts/` URLs were inserted into the demo database by hand because the upload endpoint is BLG-10 |
| `blg-04/09-blg04-add-image-by-edit-400.png` | `PATCH` that adds a `/uploads/posts/` URL the post does not have: 400 "images can only reorder or remove this post's uploaded images" |
| `blg-04/10-blg04-outside-url-400.png` | `PATCH` with `http://example.com/not-an-image.exe`: 400 on `images` (only `/uploads/posts/` URLs are accepted) |

## BLG-05 (TRVL-89) comment on published posts

| File | What it shows |
|---|---|
| `blg-05/01-blg05-comment-201.png` | `POST /api/posts/{id}/comments` as User B: 201 |
| `blg-05/02-blg05-blank-comment-400.png` | A blank comment: 400 on `body` |
| `blg-05/03-blg05-501-chars-400.png` | A 501-character comment: 400 on `body` |
| `blg-05/04-blg05-comment-on-draft-404.png` | Commenting on a draft: 404 |
| `blg-05/05-blg05-comments-oldest-first-200.png` | `GET /api/posts/{id}/comments`: 200, comments oldest first |

## BLG-06 (TRVL-90) like a post once and remove the like

| File | What it shows |
|---|---|
| `blg-06/01-blg06-like-200.png` | `POST /api/posts/{id}/like` as User B: 200, `liked` true, `likeCount` 1 |
| `blg-06/02-blg06-like-again-409.png` | The same like again: 409 `ALREADY_LIKED` |
| `blg-06/03-blg06-remove-like-200.png` | `DELETE /api/posts/{id}/like`: 200, `likeCount` 0 |
| `blg-06/04-blg06-remove-missing-like-404.png` | Removing a like that does not exist: 404 |
| `blg-06/05-blg06-guest-likes-401.png` | Liking as a guest: 401 |

## BLG-07 (TRVL-91) edit and delete own comments

| File | What it shows |
|---|---|
| `blg-07/01-blg07-edit-own-comment-200.png` | `PATCH /api/comments/{id}` as the comment's author: 200 |
| `blg-07/02-blg07-edit-other-users-comment-403.png` | Editing User B's comment as User A: 403 |
| `blg-07/03-blg07-delete-other-users-comment-403.png` | Deleting User B's comment as User A: 403 |
| `blg-07/04-blg07-delete-own-comment-204.png` | `DELETE /api/comments/{id}` as the comment's author: 204 |

## BLG-08 (TRVL-92) tags

| File | What it shows |
|---|---|
| `blg-08/01-blg08-six-tags-400.png` | Six tags: 400 "a post has at most 5 tags" |
| `blg-08/02-blg08-tag-over-30-chars-400.png` | A 36-character tag: 400 "each tag must be 1-30 characters" |
| `blg-08/03-blg08-edit-tags-200.png` | `PATCH /api/posts/{id}` with new tags: 200, lowercased |
| `blg-08/04-blg08-click-tag-200.png` | `GET /api/tags/EGYPT/posts`: 200, both published posts tagged `egypt` (case ignored) |

## BLG-09 (TRVL-93) search published posts

| File | What it shows |
|---|---|
| `blg-09/01-blg09-search-ordered-by-interactions-200.png` | `GET /api/posts?q=egypt`: 200, the post with a like and a comment first |
| `blg-09/02-blg09-search-by-author-name-200.png` | `GET /api/posts?q=User A`: 200, matched by author name |
| `blg-09/03-blg09-no-results-200.png` | A keyword that matches nothing: 200, `total` 0, empty `items` |

## BLG-10 (TRVL-94) attach and remove post images

| File | What it shows |
|---|---|
| `blg-10/01-blg10-upload-png-201.png` | `POST /api/posts/{id}/images` with a PNG as User A: 201, `/uploads/posts/<uuid>.png` added |
| `blg-10/02-blg10-text-file-400.png` | A text file sent as image/png: 400 on `images` |
| `blg-10/03-blg10-other-user-uploads-403.png` | Uploading to User A's post as User B: 403 |
| `blg-10/04-blg10-remove-image-200.png` | `DELETE /api/posts/{id}/images/{imageId}`: 200, `images` empty |
| `blg-10/05-blg10-removed-image-again-404.png` | Removing the same image again: 404 "Image not found" |

## BLG-12 (TRVL-95) public author page

| File | What it shows |
|---|---|
| `blg-12/01-blg12-author-page-200.png` | `GET /api/authors/{id}` as a guest: 200, name, join date and published posts only |
| `blg-12/02-blg12-unknown-author-404.png` | An unknown author id: 404 |
