import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { GENERAL_METADATA_FIELDS, getArticleTypes } from '../services/articleTypes.js';

const router = Router({ mergeParams: true });

// GET /api/worlds/:wid/article-types
router.get('/', asyncHandler(async (_req, res) => {
  res.json({
    generalMetadataFields: GENERAL_METADATA_FIELDS,
    articleTypes: getArticleTypes(),
  });
}));

export default router;
