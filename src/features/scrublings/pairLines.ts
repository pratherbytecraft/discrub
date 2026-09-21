/**
 * Extra two-line exchanges for the pair scenes (owner, 2026-09-20: the same
 * "Humidify." "Thanks?" every two minutes got old). Each scene keeps its
 * animation and its original captions; these are alternatives that make sense
 * for the same animation. The scheduler picks one at random and never the
 * one it showed last for that scene.
 *
 * Keys are `first+second:firstActivity/secondActivity` exactly as the scene
 * is written in PAIR_ACTIONS (see `sceneId`). Lines stay at 22 characters or
 * fewer so the text fits over a head. The first line belongs to the first
 * character in the key, the second line to the other. English only, like the
 * originals.
 */
export type Exchange = [string, string];

export const MAX_LINE_LENGTH = 22;

export const EXTRA_LINES: Record<string, Exchange[]> = {
  'suds+cat:scrub/onbucket': [
    ['I need that bucket.', 'No you do not.'],
    ['Off, please.', 'Purr.'],
    ['That is not a bed.', 'It is now.'],
    ['Five more minutes?', 'Ten.'],
    ['You shed in it.', 'You are welcome.'],
  ],
  'suds+dog:wring/run': [
    ['Get the sponge!', 'Got it! Mine now.'],
    ['Bath time.', 'Nope!'],
    ['Drop it.', 'Never.'],
    ['Who tracked mud in?', 'Not me. Bye!'],
    ['Go long!', 'Going!'],
  ],
  'suds+adventurer:carry/look': [
    ['Free polish. Trust me.', 'My platebody...'],
    ['Back in one minute.', 'It has been ten.'],
    ['I will clean it.', 'That was my best set.'],
    ['Doubling armor!', 'I fell for it again.'],
    ['Needs a deep clean.', 'It was already clean.'],
  ],
  'suds+alien:scrub/idle': [
    ['Bugs on the glass.', 'Those are passengers.'],
    ['Wax is extra.', 'What is wax.'],
    ['Where do I park this?', 'You do not.'],
    ['Long trip?', 'Four light years.'],
    ['Spot free rinse?', 'Affirmative.'],
  ],
  'suds+ghost:scrub/giggle': [
    ['Missed a spot.', 'That is all of me.'],
    ['You are see through.', 'Squeaky clean.'],
    ['Sheets need a wash.', 'That tickles.'],
    ['How old is this stain?', 'Three hundred years.'],
    ['Almost done.', 'Hehehe.'],
  ],
  'cat+dog:walk/run': [
    ['Not again.', 'Again!'],
    ['Tag.', 'You are it!'],
    ['Leave me alone.', 'Play? Play? Play?'],
    ['Too slow.', 'Wait up!'],
    ['I was napping.', 'Not any more!'],
  ],
  'cat+adventurer:hatbat/hatoff': [
    ['It moved.', 'That hat is rare.'],
    ['It dangles.', 'It is not for you.'],
    ['Mine.', 'It cost me a fortune.'],
    ['Bap bap.', 'Stop that.'],
    ['Knocked it off.', 'Every time.'],
  ],
  'cat+alien:annoyed/lift': [
    ['Put. Me. Down.', 'Sample collected.'],
    ['I have claws.', 'Noted.'],
    ['Hiss.', 'Specimen is loud.'],
    ['Not the beam.', 'The beam.'],
    ['I will remember this.', 'So will science.'],
  ],
  'cat+ghost:arch/stare': [
    ['I see you.', 'Nobody else does.'],
    ['Hiss.', 'Boo?'],
    ['Stop floating.', 'Stop staring.'],
    ['You smell old.', 'Rude.'],
    ['...', 'You blinked.'],
  ],
  'dog+adventurer:stick/whip': [
    ['Throw it!', 'It is not a toy.'],
    ['Best stick ever.', 'That is a rare drop.'],
    ['One more time!', 'Last one. Maybe.'],
    ['Brought it back!', 'Good fetch.'],
    ['Is it a stick?', 'It is not a stick.'],
  ],
  'dog+alien:skyward/lift': [
    ['My stick is flying!', 'Borrowing it.'],
    ['Bring it back!', 'Analyzing stick.'],
    ['Woof?', 'It is just wood.'],
    ['Can I fly too?', 'You are too wiggly.'],
    ['Up there!', 'Fetch: inconclusive.'],
  ],
  'dog+ghost:hide/walk': [
    ['Who is there?', 'Just me.'],
    ['I am not scared.', 'Your tail says yes.'],
    ['Grr.', 'Oooooh.'],
    ['Can I sniff you?', 'Nothing to sniff.'],
    ['Go away!', 'I live here.'],
  ],
  'adventurer+alien:whip/walk': [
    ['Stand still.', 'No.'],
    ['Nice dodge.', 'I hover.'],
    ['What level are you?', 'Unknown.'],
    ['Is that a pet?', 'I am the captain.'],
    ['Whip spec!', 'Missed.'],
  ],
  'adventurer+ghost:check/hat': [
    ['Where is my hat?', 'What hat?'],
    ['Not funny.', 'A little funny.'],
    ['Give it back.', 'Finders keepers.'],
    ['That is a rare.', 'Suits me better.'],
    ['I checked the bank.', 'Check higher.'],
  ],
  'mage+suds:cast/wring': [
    ['Water Wave.', 'Saved me a trip.'],
    ['Need a refill?', 'Always.'],
    ['Water Blast!', 'Bucket is full. Stop.'],
    ['Costs me a rune each.', 'Put it on my tab.'],
    ['Water Surge.', 'Now I am soaked too.'],
    ['Is it clean yet?', 'It is wet. Close.'],
  ],
  'mage+cat:cast/arch': [
    ['Ice Blitz.', 'Cold. Rude.'],
    ['Hold still.', 'I was still.'],
    ['Snare.', 'Hiss.'],
    ['Bind!', 'I did not consent.'],
    ['Only twenty seconds.', 'I will remember.'],
  ],
  'mage+dog:walk/stick': [
    ['That is my staff.', 'Best stick yet!'],
    ['Drop the staff.', 'Tug of war!'],
    ['Careful, it is old.', 'Tastes ancient.'],
    ['I need it to cast.', 'Throw it then!'],
    ['Not a chew toy.', 'Kind of is.'],
  ],
  'mage+adventurer:cast/whip': [
    ['No food, no prayer.', 'Deal.'],
    ['Staking?', 'I never learn.'],
    ['Splash.', 'Lucky.'],
    ['Protect from Magic?', 'Always.'],
    ['Rematch.', 'gg'],
  ],
  'mage+adventurer:alch/hatoff': [
    ['Nice hat. High Alch.', 'It was not for sale.'],
    ['Worth more as coins.', 'It really is not.'],
    ['Oops. Misclick.', 'Sure it was.'],
    ['Thirty coins.', 'That was priceless.'],
    ['I needed the xp.', 'Buy your own hat.'],
  ],
  'mage+adventurer:cast/dh_swing': [
    ['Do not get hit.', 'Too late.'],
    ['Eat. Eat now.', 'One more swing.'],
    ['Low health is risky.', 'That is the point.'],
    ['Freeze and step back.', 'Come closer.'],
    ['Big hit incoming.', 'Hope so.'],
  ],
  'mage+alien:tele/walk': [
    ['Home teleport.', 'He vanished.'],
    ['Bye.', 'Teach me that.'],
    ['Need a lift?', 'I have a ship.'],
    ['Lumbridge.', 'Is that a planet?'],
    ['Watch this.', 'Impressive.'],
  ],
  'mage+ghost:walk/walk': [
    ['Ahrim?', 'Wrong crypt.'],
    ['Have we met?', 'Six brothers ago.'],
    ['You look familiar.', 'You look alive.'],
    ['Which tunnel?', 'Not this one.'],
    ['Is the chest here?', 'Keep digging.'],
  ],
  'pker+suds:skulled/scrub': [
    ['Got any loot?', 'A sponge.'],
    ['Drop your items.', 'It is a bucket.'],
    ['You are in the wildy.', 'This is a kitchen.'],
    ['Nice skull.', 'Needs a polish.'],
    ['Risking anything?', 'Soap.'],
  ],
  'pker+cat:noscim/drag': [
    ['My scimitar!', 'Mine now.'],
    ['That is sharp.', 'So am I.'],
    ['Bring that back.', 'No.'],
    ['I need it to pk.', 'I need it to nap on.'],
    ['Drop it.', 'Make me.'],
  ],
  'pker+dog:run/run': [
    ['Stand and fight.', 'Chase me!'],
    ['Tele blocked?', 'Still got legs!'],
    ['You cannot outrun me.', 'Watch!'],
    ['Come back.', 'Catch me first!'],
    ['Nice run energy.', 'Zoomies!'],
  ],
  'pker+adventurer:slash/idle': [
    ['Free stuff in wildy.', 'Nice try.'],
    ['Follow me.', 'Absolutely not.'],
    ['One fight. Level 1.', 'I know that trick.'],
    ['Bring your best gear.', 'I will bring nothing.'],
    ['Scared?', 'Busy.'],
  ],
  'pker+mage:tb/cast': [
    ['No escape.', 'Did not want one.'],
    ['Tele block.', 'Ice Barrage.'],
    ['Got you.', 'Frozen. Got you.'],
    ['You are stuck here.', 'So are you.'],
    ['Easy loot.', 'Try me.'],
  ],
  'pker+alien:noscim/lift': [
    ['Give it back.', 'Studying it.'],
    ['That was expensive.', 'It is a curved stick.'],
    ['I will pk you.', 'From down there?'],
    ['My only weapon.', 'Now it is data.'],
    ['Hey!', 'Thank you, human.'],
  ],
  'pker+ghost:eat/giggle': [
    ['Lost it all.', 'Been there.'],
    ['Out of food.', 'I do not eat.'],
    ['How did you go?', 'No food left.'],
    ['Last shark.', 'Make it count.'],
    ['Haunt the wildy?', 'Every night.'],
  ],
  'alien+ghost:wave/wave': [
    ['greetings', 'oooh'],
    ['take me to your leader', 'he is dead too'],
    ['are you a gas?', 'are you a frog?'],
    ['we come in peace', 'rest in peace'],
    ['bloop', 'boo'],
  ],
};
