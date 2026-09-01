/** @jest-environment node */
import { Encoder, Decoder, Stream, Profile } from "@garmin/fitsdk";

test("sdk loads", () => {
  const encoder = new Encoder();
  encoder.onMesg(Profile.MesgNum.FILE_ID, {
    manufacturer: "development",
    product: 1,
    timeCreated: new Date(),
    type: "activity",
  });
  const bytes = encoder.close();
  const decoder = new Decoder(Stream.fromByteArray(bytes));
  expect(decoder.isFIT()).toBe(true);
  const { messages, errors } = decoder.read();
  expect(errors).toHaveLength(0);
  expect(messages.fileIdMesgs?.length).toBe(1);
});
