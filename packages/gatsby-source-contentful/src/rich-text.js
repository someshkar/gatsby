// import { fixId } from "./normalize"
import { documentToReactComponents } from "@contentful/rich-text-react-renderer"
import resolveResponse from "contentful-resolve-response"

const _ = require(`lodash`)

// Copied for now as normalize.js has node dependencies. Will move it to a separate file later.
const fixId = id => {
  if (!_.isString(id)) {
    id = id.toString()
  }
  return `c${id}`
}

function renderRichText({ raw, references }, options = {}) {
  const richText = JSON.parse(raw)

  // If no references are given, there is no need to resolve them
  if (!references) {
    return documentToReactComponents(richText, options)
  }

  // Create dummy response so we can use official libraries for resolving the entries
  const dummyResponse = {
    items: [
      {
        sys: { type: `Entry` },
        richText,
      },
    ],
    includes: {
      Entry: references
        .filter(({ __typename }) => __typename !== `ContentfulAsset`)
        .map(reference => {
          return {
            ...reference,
            sys: { type: `Entry`, id: fixId(reference.contentful_id) },
          }
        }),
      Asset: references
        .filter(({ __typename }) => __typename === `ContentfulAsset`)
        .map(reference => {
          return {
            ...reference,
            sys: { type: `Asset`, id: fixId(reference.contentful_id) },
          }
        }),
    },
  }

  const resolved = resolveResponse(dummyResponse, {
    removeUnresolved: true,
  })

  return documentToReactComponents(resolved[0].richText, options)
}

exports.renderRichText = renderRichText
