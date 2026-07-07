import { Router } from 'express';
import { z } from 'zod';
import { generateNames, listNames, addNames, deleteName, CULTURAL_PROFILES } from '../services/nameBank.js';
import type { EntityType, Gender, SocialClass, NameComponent, ListNamesFilter } from '../services/nameBank.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireTenantContext } from '../tenant.js';

const router = Router({ mergeParams: true });

// ---------------------------------------------------------------------------
// GET /api/worlds/:wid/names
// ---------------------------------------------------------------------------

router.get('/', asyncHandler(async (req, res) => {
  const { worldId, ownerId } = requireTenantContext(req);
  const { entityType, gender, socialClass, nameComponent, tags } = req.query as Record<string, string | undefined>;
  const tagList = tags ? tags.split(',').map((t) => t.trim()).filter(Boolean) : undefined;

  const filter: ListNamesFilter = {
    entityType:    entityType as EntityType | undefined,
    gender:        gender as Gender | undefined,
    socialClass:   socialClass as SocialClass | undefined,
    nameComponent: nameComponent as NameComponent | undefined,
    tags:          tagList,
  };

  const entries = await listNames(worldId, filter, undefined, ownerId);
  res.json({
    names:    entries,
    profiles: Object.entries(CULTURAL_PROFILES).map(([id, p]) => ({ id, label: p.label, feel: p.feel })),
  });
}));

// ---------------------------------------------------------------------------
// POST /api/worlds/:wid/names/generate  — generate candidates (no DB write)
// ---------------------------------------------------------------------------

const GenerateSchema = z.object({
  profileId:     z.string().min(1),
  entityType:    z.enum(['person', 'place', 'faction', 'concept']),
  gender:        z.enum(['male', 'female', 'neutral']).optional().default('neutral'),
  socialClass:   z.enum(['common', 'noble']).optional().default('common'),
  nameComponent: z.enum(['full', 'first', 'family']).optional().default('full'),
  count:         z.number().int().min(1).max(20).optional().default(8),
});

router.post('/generate', asyncHandler(async (req, res) => {
  const parse = GenerateSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten().fieldErrors });
    return;
  }

  const { worldId, ownerId } = requireTenantContext(req);
  if (!CULTURAL_PROFILES[parse.data.profileId]) {
    res.status(400).json({ error: `Unknown profile: ${parse.data.profileId}` });
    return;
  }

  try {
    const names = await generateNames(parse.data.profileId, parse.data.entityType, worldId, parse.data.count, {
      gender:        parse.data.gender,
      socialClass:   parse.data.socialClass,
      nameComponent: parse.data.nameComponent,
    }, ownerId);
    res.json({ names });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}));

// ---------------------------------------------------------------------------
// POST /api/worlds/:wid/names  — save accepted names
// ---------------------------------------------------------------------------

const SaveSchema = z.object({
  names: z.array(z.object({
    name:          z.string().min(1),
    profileId:     z.string().min(1),
    entityType:    z.enum(['person', 'place', 'faction', 'concept']),
    gender:        z.enum(['male', 'female', 'neutral']).optional().default('neutral'),
    socialClass:   z.enum(['common', 'noble']).optional().default('common'),
    nameComponent: z.enum(['full', 'first', 'family']).optional().default('full'),
    tags:          z.array(z.string()).optional().default([]),
    source:        z.enum(['generated', 'user']).optional().default('generated'),
  })).min(1),
});

router.post('/', asyncHandler(async (req, res) => {
  const parse = SaveSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten().fieldErrors });
    return;
  }

  const { worldId } = requireTenantContext(req);
  try {
    const saved = await addNames(worldId, parse.data.names);
    res.status(201).json({ names: saved });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}));

// ---------------------------------------------------------------------------
// DELETE /api/worlds/:wid/names/:nid
// ---------------------------------------------------------------------------

router.delete('/:nid', asyncHandler(async (req, res) => {
  const { ownerId } = requireTenantContext(req);
  await deleteName((req.params as Record<string, string>).nid, ownerId);
  res.status(204).send();
}));

export default router;
