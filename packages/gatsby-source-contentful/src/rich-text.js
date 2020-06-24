// import { fixId } from "./normalize"
import { documentToReactComponents } from "@contentful/rich-text-react-renderer"
import resolveResponse from "contentful-resolve-response"

const _ = require(`lodash`)
const { BLOCKS, INLINES } = require(`@contentful/rich-text-types`)

const isEntryReferenceNode = node =>
  [
    BLOCKS.EMBEDDED_ENTRY,
    INLINES.ENTRY_HYPERLINK,
    INLINES.EMBEDDED_ENTRY,
  ].indexOf(node.nodeType) >= 0

const isAssetReferenceNode = node =>
  [BLOCKS.EMBEDDED_ASSET, INLINES.ASSET_HYPERLINK].indexOf(node.nodeType) >= 0

const isEntryReferenceField = field => _.get(field, `sys.type`) === `Entry`
const isAssetReferenceField = field => _.get(field, `sys.type`) === `Asset`

const getFieldProps = (contentType, fieldName) =>
  contentType.fields.find(({ id }) => id === fieldName)

const getAssetWithFieldLocalesResolved = ({ asset, getField }) => {
  return {
    ...asset,
    fields: _.mapValues(asset.fields, getField),
  }
}

const getFieldWithLocaleResolved = ({
  field,
  contentTypesById,
  getField,
  defaultLocale,
  resolvedEntryIDs,
}) => {
  // If the field is itself a reference to another entry, recursively resolve
  // that entry's field locales too.
  if (isEntryReferenceField(field)) {
    const key = `${field.sys.id}___${field.sys.type}`
    if (resolvedEntryIDs.has(key)) {
      return field
    }

    return getEntryWithFieldLocalesResolved({
      entry: field,
      contentTypesById,
      getField,
      defaultLocale,
      resolvedEntryIDs: resolvedEntryIDs.add(key),
    })
  }

  if (isAssetReferenceField(field)) {
    return getAssetWithFieldLocalesResolved({
      asset: field,
      getField,
    })
  }

  if (Array.isArray(field)) {
    return field.map(fieldItem =>
      getFieldWithLocaleResolved({
        field: fieldItem,
        contentTypesById,
        getField,
        defaultLocale,
        resolvedEntryIDs,
      })
    )
  }

  return field
}

const getEntryWithFieldLocalesResolved = ({
  entry,
  contentTypesById,
  getField,
  defaultLocale,

  /**
   * Keep track of entries we've already resolved, in case two or more entries
   * have circular references (so as to prevent an infinite loop).
   */
  resolvedEntryIDs = new Set(),
}) => {
  const contentType = contentTypesById.get(entry.sys.contentType.sys.id)

  return {
    ...entry,
    fields: _.mapValues(entry.fields, (field, fieldName) => {
      const fieldProps = getFieldProps(contentType, fieldName)

      const fieldValue = fieldProps.localized
        ? getField(field)
        : field[defaultLocale]

      return getFieldWithLocaleResolved({
        field: fieldValue,
        contentTypesById,
        getField,
        defaultLocale,
        resolvedEntryIDs,
      })
    }),
  }
}

const getNormalizedRichTextNode = ({
  node,
  contentTypesById,
  getField,
  defaultLocale,
}) => {
  if (isEntryReferenceNode(node)) {
    return {
      ...node,
      data: {
        ...node.data,
        target: getEntryWithFieldLocalesResolved({
          entry: node.data.target,
          contentTypesById,
          getField,
          defaultLocale,
        }),
      },
    }
  }

  if (isAssetReferenceNode(node)) {
    return {
      ...node,
      data: {
        ...node.data,
        target: getAssetWithFieldLocalesResolved({
          asset: node.data.target,
          getField,
        }),
      },
    }
  }

  if (Array.isArray(node.content)) {
    return {
      ...node,
      content: node.content.map(childNode =>
        getNormalizedRichTextNode({
          node: childNode,
          contentTypesById,
          getField,
          defaultLocale,
        })
      ),
    }
  }

  return node
}

/**
 * Walk through the rich-text object, resolving locales on referenced entries
 * (and on entries they've referenced, etc.).
 */
const getNormalizedRichTextField = ({
  field,
  contentTypesById,
  getField,
  defaultLocale,
}) => {
  if (field && field.content) {
    return {
      ...field,
      content: field.content.map(node =>
        getNormalizedRichTextNode({
          node,
          contentTypesById,
          getField,
          defaultLocale,
        })
      ),
    }
  }

  return field
}

exports.getNormalizedRichTextField = getNormalizedRichTextField

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
